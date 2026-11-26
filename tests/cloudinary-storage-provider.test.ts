import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  buildCloudinaryPrivateDownloadUrl,
  cloudinaryResourceToStoragePath,
  createUploadDescriptor,
  getActiveStorageProvider,
  isAllowedCloudinaryPublicUrl,
  mintPrivateMediaToken,
  parseStoragePathForCloudinary,
  signCloudinaryParams,
  verifyPrivateMediaToken,
} from "@/lib/server/storage-provider";

describe("Cloudinary Dual Storage Provider & Private Media Token Security", () => {
  const origCloud = process.env.CLOUDINARY_CLOUD_NAME;
  const origKey = process.env.CLOUDINARY_API_KEY;
  const origSecret = process.env.CLOUDINARY_API_SECRET;

  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = "demo-chopass";
    process.env.CLOUDINARY_API_KEY = "1234567890";
    process.env.CLOUDINARY_API_SECRET = "super-secret-cloudinary-key-1234";
  });

  afterEach(() => {
    if (origCloud === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = origCloud;
    if (origKey === undefined) delete process.env.CLOUDINARY_API_KEY;
    else process.env.CLOUDINARY_API_KEY = origKey;
    if (origSecret === undefined) delete process.env.CLOUDINARY_API_SECRET;
    else process.env.CLOUDINARY_API_SECRET = origSecret;
  });

  it("Tự động chọn Cloudinary khi đủ 3 biến env và fallback Firebase khi thiếu", () => {
    expect(getActiveStorageProvider()).toBe("cloudinary");

    delete process.env.CLOUDINARY_API_SECRET;
    expect(getActiveStorageProvider()).toBe("firebase");
    expect(
      createUploadDescriptor({
        storagePath: "public/listings/u1/d1/img_1.webp",
        kind: "listing",
        sessionId: "sess_12345678",
      })
    ).toEqual({ provider: "firebase" });
  });

  it("Ánh xạ hai chiều chính xác giữa logical storagePath và Cloudinary public_id / delivery type", () => {
    const pub = parseStoragePathForCloudinary("public/listings/uid1/draft1/img_0.jpg");
    expect(pub).toEqual({
      publicId: "public/listings/uid1/draft1/img_0",
      format: "jpg",
      deliveryType: "upload",
    });
    expect(cloudinaryResourceToStoragePath(pub.publicId, "jpeg")).toBe(
      "public/listings/uid1/draft1/img_0.jpg"
    );

    const priv = parseStoragePathForCloudinary("private/cards/uid1/sess_1234.webp");
    expect(priv).toEqual({
      publicId: "private/cards/uid1/sess_1234",
      format: "webp",
      deliveryType: "authenticated",
    });
  });

  it("createUploadDescriptor tạo chữ ký SHA-1 chuẩn Cloudinary, khóa type=authenticated cho thẻ SV & ảnh chat", () => {
    const desc = createUploadDescriptor({
      storagePath: "private/cards/uid1/sess_12345678.webp",
      kind: "card",
      sessionId: "sess_12345678",
      nowSec: 1700000000,
    });

    expect(desc.provider).toBe("cloudinary");
    expect(desc.url).toBe("https://api.cloudinary.com/v1_1/demo-chopass/image/upload");
    expect(desc.fields?.type).toBe("authenticated");
    expect(desc.fields?.overwrite).toBe("false");
    expect(desc.fields?.allowed_formats).toBe("webp,jpg,jpeg");
    expect(desc.fields?.context).toBe("sessionId=sess_12345678");

    const expectedSig = crypto
      .createHash("sha1")
      .update(
        "allowed_formats=webp,jpg,jpeg&context=sessionId=sess_12345678&overwrite=false&public_id=private/cards/uid1/sess_12345678&timestamp=1700000000&type=authenticatedsuper-secret-cloudinary-key-1234"
      )
      .digest("hex");
    expect(desc.fields?.signature).toBe(expectedSig);
  });

  it("isAllowedCloudinaryPublicUrl chỉ chấp nhận đúng cloudName và đúng thư mục user", () => {
    const ownListingRe = /^public\/listings\/uid1\/[A-Za-z0-9_-]{4,64}\/[A-Za-z0-9_-]{4,64}\.(webp|jpg)$/;

    expect(
      isAllowedCloudinaryPublicUrl(
        "https://res.cloudinary.com/demo-chopass/image/upload/v1700000000/public/listings/uid1/draft1/img_1.webp",
        ownListingRe
      )
    ).toBe(true);

    // Sai cloudName (attacker Cloudinary account) -> TỪ CHỐI
    expect(
      isAllowedCloudinaryPublicUrl(
        "https://res.cloudinary.com/hacker-cloud/image/upload/v1700000000/public/listings/uid1/draft1/img_1.webp",
        ownListingRe
      )
    ).toBe(false);

    // Sai chủ sở hữu (uid2) -> TỪ CHỐI
    expect(
      isAllowedCloudinaryPublicUrl(
        "https://res.cloudinary.com/demo-chopass/image/upload/v1700000000/public/listings/uid2/draft1/img_1.webp",
        ownListingRe
      )
    ).toBe(false);

    // Path traversal -> TỪ CHỐI
    expect(
      isAllowedCloudinaryPublicUrl(
        "https://res.cloudinary.com/demo-chopass/image/upload/public/listings/uid1/../uid2/img_1.webp",
        ownListingRe
      )
    ).toBe(false);
  });

  it("mintPrivateMediaToken / verifyPrivateMediaToken xác thực chữ ký HMAC-SHA256, chặn giả mạo và chặn hết hạn 5 phút", () => {
    const nowMs = 1_700_000_000_000;
    const path = "private/cards/uid1/sess_12345678.webp";
    const token = mintPrivateMediaToken(path, 5 * 60 * 1000, nowMs);

    expect(verifyPrivateMediaToken(token, nowMs + 60_000)).toEqual({
      valid: true,
      path,
    });

    // Hết hạn sau 5 phút -> từ chối
    const expired = verifyPrivateMediaToken(token, nowMs + 5 * 60 * 1000 + 1);
    expect(expired.valid).toBe(false);

    // Bị chỉnh sửa 1 ký tự -> từ chối
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(verifyPrivateMediaToken(tampered, nowMs + 1000).valid).toBe(false);

    // Đường dẫn không thuộc private/(cards|chats) -> ném lỗi
    expect(() => mintPrivateMediaToken("public/listings/uid1/d1/a.webp")).toThrow();
  });

  it("buildCloudinaryPrivateDownloadUrl ký đầy đủ expires_at + type=authenticated", () => {
    const urlStr = buildCloudinaryPrivateDownloadUrl(
      "private/chats/conv_1/sess_chat_0.jpg",
      60,
      1700000000
    );
    const u = new URL(urlStr);
    expect(u.origin).toBe("https://api.cloudinary.com");
    expect(u.pathname).toBe("/v1_1/demo-chopass/image/download");
    expect(u.searchParams.get("public_id")).toBe("private/chats/conv_1/sess_chat_0");
    expect(u.searchParams.get("format")).toBe("jpg");
    expect(u.searchParams.get("type")).toBe("authenticated");
    expect(u.searchParams.get("expires_at")).toBe("1700000060");
    expect(u.searchParams.get("signature")).toBe(
      signCloudinaryParams(
        {
          expires_at: "1700000060",
          format: "jpg",
          public_id: "private/chats/conv_1/sess_chat_0",
          timestamp: "1700000000",
          type: "authenticated",
        },
        "super-secret-cloudinary-key-1234"
      )
    );
  });
});
