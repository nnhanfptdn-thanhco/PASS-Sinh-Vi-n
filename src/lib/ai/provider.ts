import "server-only";
import { ApiError } from "@/lib/server/http";
import { redactSecretsFromOutput } from "./prompt";
import type { AIHelpDoc, AIPublicListingDTO } from "./retrieval";
import { normalizeVi } from "@/lib/search/normalize";

export interface AIProviderRequest {
  systemPrompt: string;
  contextBlock: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  userMessage: string;
  listings: AIPublicListingDTO[];
  helpDocs: AIHelpDoc[];
  signal?: AbortSignal;
  onToken?: (delta: string) => void;
}

export interface AIProviderResult {
  text: string;
  providerName: string;
  modelName: string;
  tokensUsedEstimate: number;
  outputTokensEstimate?: number;
}

export interface AIProvider {
  name: string;
  generate(req: AIProviderRequest): Promise<AIProviderResult>;
}

// 12s mỗi attempt x tối đa 2 attempts = <= 24s, luôn nằm gọn trong maxDuration = 30s của Vercel route
const PROVIDER_TIMEOUT_MS = 12_000;

let testProviderOverride: AIProvider | null = null;

export function setAIProviderForTests(provider: AIProvider | null): void {
  testProviderOverride = provider;
}

function combineSignals(timeoutMs: number, externalSignal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("AI_TIMEOUT")), timeoutMs);
  const onAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
    },
  };
}

class GeminiProvider implements AIProvider {
  public readonly name = "gemini";
  constructor(private readonly apiKey: string, private readonly model: string) {}

  async generate(req: AIProviderRequest): Promise<AIProviderResult> {
    const wantsStream = Boolean(req.onToken);
    const endpoint = wantsStream
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`
      : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;

    const contents = [
      ...req.history.slice(-6).map((h) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.text }],
      })),
      {
        role: "user",
        parts: [{ text: `${req.contextBlock}\n\nCâu hỏi người dùng:\n${req.userMessage}` }],
      },
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
      const { signal, cleanup } = combineSignals(PROVIDER_TIMEOUT_MS, req.signal);
      let emittedAnyToken = false;

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.systemPrompt }] },
            contents,
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 700,
            },
          }),
          signal,
        });

        if (res.status >= 500 && attempt === 0) {
          continue;
        }
        if (!res.ok) {
          throw new ApiError(
            503,
            "AI_PROVIDER_UNAVAILABLE",
            "NnhanAI tạm thời không phản hồi từ nhà cung cấp. Vui lòng thử lại sau."
          );
        }

        let rawText = "";
        if (wantsStream && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let sseBuf = "";

          const processSseFrame = (frame: string) => {
            const lines = frame.split(/\r?\n/);
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const payloadStr = line.slice(5).trim();
              if (!payloadStr || payloadStr === "[DONE]") continue;
              try {
                const parsed = JSON.parse(payloadStr) as {
                  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
                };
                const chunkText =
                  parsed.candidates?.[0]?.content?.parts
                    ?.map((p) => p.text || "")
                    .join("") || "";
                if (chunkText) {
                  emittedAnyToken = true;
                  rawText += chunkText;
                  req.onToken?.(chunkText);
                }
              } catch {
                // Ignore malformed partial JSON frame
              }
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (req.signal?.aborted) {
              await reader.cancel().catch(() => undefined);
              throw new ApiError(499, "AI_REQUEST_ABORTED", "Yêu cầu NnhanAI đã bị hủy.");
            }
            sseBuf += decoder.decode(value, { stream: true });
            const frames = sseBuf.split(/\r?\n\r?\n/);
            sseBuf = frames.pop() || "";
            for (const frame of frames) {
              processSseFrame(frame);
            }
          }
          const remaining = sseBuf + decoder.decode();
          if (remaining.trim()) {
            processSseFrame(remaining);
          }
        } else {
          const data = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          rawText =
            data.candidates?.[0]?.content?.parts
              ?.map((p) => p.text || "")
              .join("")
              .trim() || "";
        }

        if (!rawText.trim()) {
          throw new ApiError(
            503,
            "AI_PROVIDER_EMPTY",
            "NnhanAI chưa nhận được nội dung phản hồi hợp lệ."
          );
        }

        const safeText = redactSecretsFromOutput(rawText.trim());
        if (!emittedAnyToken && req.onToken) {
          req.onToken(safeText);
        }
        const outputTokensEstimate = Math.ceil(safeText.length / 3);
        return {
          text: safeText,
          providerName: this.name,
          modelName: this.model,
          tokensUsedEstimate: Math.ceil((req.userMessage.length + safeText.length) / 3),
          outputTokensEstimate,
        };
      } catch (err: unknown) {
        if (err instanceof ApiError) throw err;
        if (req.signal?.aborted) {
          throw new ApiError(499, "AI_REQUEST_ABORTED", "Yêu cầu NnhanAI đã bị hủy.");
        }
        if (attempt === 0 && !emittedAnyToken) continue;
        throw new ApiError(
          503,
          "AI_PROVIDER_UNAVAILABLE",
          "Kết nối đến NnhanAI bị gián đoạn hoặc quá hạn. Vui lòng thử lại sau."
        );
      } finally {
        cleanup();
      }
    }

    throw new ApiError(
      503,
      "AI_PROVIDER_UNAVAILABLE",
      "NnhanAI tạm thời gián đoạn. Vui lòng thử lại sau."
    );
  }
}

class GroundedFallbackProvider implements AIProvider {
  public readonly name = "grounded_builtin";

  async generate(req: AIProviderRequest): Promise<AIProviderResult> {
    if (req.signal?.aborted) {
      throw new ApiError(499, "AI_REQUEST_ABORTED", "Yêu cầu NnhanAI đã bị hủy.");
    }

    const norm = normalizeVi(req.userMessage);
    const sections: string[] = [];

    if (req.listings.length > 0) {
      sections.push("Dưới đây là các tin đăng công khai phù hợp trên Chợ Pass Sinh Viên:");
      for (const l of req.listings) {
        sections.push(
          `• **${l.title}** — Giá: ${l.price.toLocaleString("vi-VN")} đ (${l.condition})${
            l.publicMeetingPoint ? ` | Điểm hẹn: ${l.publicMeetingPoint}` : ""
          } — Xem chi tiết: ${l.url}`
        );
      }
    }

    if (norm.includes("mo ta") || norm.includes("viet bai") || norm.includes("ban do")) {
      sections.push(
        "Mẹo viết mô tả món đồ hiệu quả & đúng quy định:\n1. Nêu rõ tên, model, thời gian đã sử dụng và lỗi nhỏ nếu có (minh bạch giúp bán nhanh hơn).\n2. Đề xuất điểm hẹn công khai (Cổng trường, sảnh KTX...).\n3. Không chèn số điện thoại, Zalo hoặc đường dẫn liên hệ ngoài để tránh bị bộ lọc từ chối."
      );
    }

    if (req.helpDocs.length > 0 && sections.length === 0) {
      sections.push("Thông tin hướng dẫn chính thức từ Chợ Pass Sinh Viên:");
      for (const doc of req.helpDocs) {
        sections.push(`• **${doc.title}** (${doc.url}):\n  ${doc.summary}`);
      }
    }

    if (sections.length === 0) {
      sections.push(
        "Mình là NnhanAI, trợ lý của Chợ Pass Sinh Viên. Hiện mình chưa tìm thấy nguồn tin công khai khớp trực tiếp với câu hỏi này; bạn có thể thử tìm tại /search hoặc chọn các chủ đề hướng dẫn đăng tin, giữ chỗ và giao dịch an toàn."
      );
    }

    const safeText = redactSecretsFromOutput(sections.join("\n\n"));
    if (req.onToken) {
      const words = safeText.split(" ");
      for (let i = 0; i < words.length; i += 6) {
        if (req.signal?.aborted) {
          throw new ApiError(499, "AI_REQUEST_ABORTED", "Yêu cầu NnhanAI đã bị hủy.");
        }
        const slice = words.slice(i, i + 6).join(" ") + (i + 6 < words.length ? " " : "");
        req.onToken(slice);
      }
    }

    const outputTokensEstimate = Math.ceil(safeText.length / 3);
    return {
      text: safeText,
      providerName: this.name,
      modelName: "chopass-grounded-v1",
      tokensUsedEstimate: Math.ceil((req.userMessage.length + safeText.length) / 3),
      outputTokensEstimate,
    };
  }
}

export function getAIProvider(): AIProvider {
  if (testProviderOverride) {
    return testProviderOverride;
  }
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    return new GeminiProvider(geminiKey, process.env.NNHANAI_MODEL || "gemini-2.5-flash");
  }
  if (process.env.NNHANAI_REQUIRE_EXTERNAL_LLM === "1") {
    throw new ApiError(
      503,
      "AI_PROVIDER_NOT_CONFIGURED",
      "Trợ lý NnhanAI chưa được cấu hình khóa dịch vụ AI trên máy chủ."
    );
  }
  return new GroundedFallbackProvider();
}
