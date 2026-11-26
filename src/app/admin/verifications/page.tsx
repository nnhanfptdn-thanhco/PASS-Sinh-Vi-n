"use client";

import * as React from "react";
import { authFetch } from "@/lib/firebase/client";
import { useAuth } from "@/lib/auth/AuthContext";
import { RequireAdmin } from "@/components/auth/RequireAdmin";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import {
  CheckCircle,
  XCircle,
  Sparkles,
  School,
  IdCard,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  ImageIcon,
} from "lucide-react";

type AdminFilter = "pending" | "approved" | "rejected" | "expired";

const FILTERS: Array<{ key: AdminFilter; label: string }> = [
  { key: "pending", label: "Chờ duyệt" },
  { key: "approved", label: "Đã duyệt" },
  { key: "rejected", label: "Từ chối" },
  { key: "expired", label: "Hết hạn" },
];

const REJECT_REASONS = [
  "Ảnh mờ, không đọc được thông tin",
  "Thẻ sinh viên đã hết hạn hiệu lực",
  "Tên trên thẻ không khớp họ tên khai báo",
  "Thẻ không hợp lệ / không phải thẻ sinh viên chính quy",
];

interface VerificationItem {
  id: string;
  userId: string;
  userEmail: string;
  realName: string;
  schoolCode: string;
  faculty?: string;
  studentClass?: string;
  studentIdLast4: string;
  status: AdminFilter;
  isEduEmail?: boolean;
  isGraduating?: boolean;
  hasCard?: boolean;
  rejectReason?: string;
  rejectNote?: string;
  createdAtMs?: number | null;
  updatedAtMs?: number | null;
}

function extractApiError(json: unknown, status: number): string {
  const j = json as { error?: unknown; message?: unknown } | null;
  if (typeof j?.error === "string") return j.error;
  const nested = j?.error as { message?: unknown } | undefined;
  if (typeof nested?.message === "string") return nested.message;
  if (typeof j?.message === "string") return j.message;
  return `Yêu cầu thất bại (HTTP ${status}).`;
}

function AdminVerificationsContent() {
  const { user, adminClaimMissing } = useAuth();
  const [items, setItems] = React.useState<VerificationItem[]>([]);
  const [filter, setFilter] = React.useState<AdminFilter>("pending");
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [processingId, setProcessingId] = React.useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = React.useState<VerificationItem | null>(null);
  const [rejectReason, setRejectReason] = React.useState(REJECT_REASONS[0]);
  const [rejectNote, setRejectNote] = React.useState("");

  const [cardUrls, setCardUrls] = React.useState<Record<string, string>>({});
  const [cardLoadingId, setCardLoadingId] = React.useState<string | null>(null);
  const reqSeq = React.useRef(0);

  const fetchItems = React.useCallback(async (status: AdminFilter) => {
    const seq = ++reqSeq.current; // bỏ qua phản hồi cũ khi đổi tab nhanh
    setIsLoading(true);
    setLoadError(null);
    setCardUrls({}); // Signed URL chỉ sống 5 phút, không giữ lại
    try {
      const res = await authFetch(`/api/admin/verifications?status=${status}`);
      const json = await res.json().catch(() => null);
      if (seq !== reqSeq.current) return;
      if (!res.ok) {
        setItems([]);
        setLoadError(
          res.status === 403
            ? "Tài khoản chưa được cấp quyền quản trị ở máy chủ (thiếu custom claim admin). Hãy đăng xuất rồi đăng nhập lại; nếu vẫn lỗi, kiểm tra API /api/auth/bootstrap."
            : extractApiError(json, res.status)
        );
        return;
      }
      setItems(Array.isArray(json?.items) ? json.items : []);
    } catch {
      if (seq !== reqSeq.current) return;
      setItems([]);
      setLoadError("Lỗi mạng khi tải danh sách. Vui lòng thử lại.");
    } finally {
      if (seq === reqSeq.current) setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchItems(filter);
  }, [filter, fetchItems]);

  // Nhận item TRỰC TIẾP qua tham số — không phụ thuộc state bất đồng bộ
  const handleAction = async (
    item: VerificationItem,
    action: "approve" | "reject",
    reason?: string,
    note?: string
  ) => {
    if (processingId) return; // chống bấm đúp
    setProcessingId(item.userId);
    setActionError(null);
    try {
      const res = await authFetch("/api/admin/verifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: item.userId,
          action,
          reason: action === "reject" ? reason : undefined,
          note: action === "reject" ? note?.trim() || undefined : undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(extractApiError(json, res.status));
        return;
      }
      setRejectTarget(null);
      setRejectNote("");
      // Nếu thao tác trên chính tài khoản của admin, làm mới token để nhận claims mới trước khi tải lại danh sách
      if (user && item.userId === user.uid) {
        await user.getIdToken(true).catch(() => undefined);
      }
      await fetchItems(filter); // lấy lại từ server, không cập nhật lạc quan
      if (json?.claimsSynced === false) {
        setActionError(
          "Đã duyệt, nhưng chưa đồng bộ quyền cho tài khoản. Hệ thống sẽ đồng bộ khi người dùng đăng nhập lại."
        );
      }
    } catch {
      setActionError("Lỗi mạng. Thao tác CHƯA được thực hiện, vui lòng thử lại.");
    } finally {
      setProcessingId(null);
    }
  };

  const loadCard = async (item: VerificationItem) => {
    if (cardLoadingId || cardUrls[item.userId]) return;
    setCardLoadingId(item.userId);
    try {
      const res = await authFetch(
        `/api/admin/verifications/card?userId=${encodeURIComponent(item.userId)}`
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || typeof json?.url !== "string") {
        setActionError(extractApiError(json, res.status));
        return;
      }
      setCardUrls((prev) => ({ ...prev, [item.userId]: json.url }));
    } catch {
      setActionError("Không tải được ảnh thẻ (lỗi mạng).");
    } finally {
      setCardLoadingId(null);
    }
  };

  return (
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Tiêu đề & Thống kê */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-surface-border pb-5">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-primary">
              Khu Vực Quản Trị Viên (Admin)
            </span>
            <h1 className="text-2xl font-heading font-extrabold text-text-main mt-0.5">
              Hàng Đợi Duyệt Thẻ Sinh Viên
            </h1>
            <p className="text-xs text-text-secondary mt-1">
              Đối chiếu thông tin khai báo với ảnh thẻ sinh viên. Tự động cấp nhãn và quyền đăng tin khi được duyệt.
            </p>
          </div>

          {/* Bộ lọc trạng thái */}
          <div className="flex items-center gap-1.5 bg-surface border border-surface-border p-1 rounded-xl shadow-subtle">
            {FILTERS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                  filter === tab.key
                    ? "bg-primary text-white shadow-sm"
                    : "text-text-secondary hover:text-text-main"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Cảnh báo lỗi tải dữ liệu */}
        {loadError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-sm text-red-700 dark:bg-red-950/40 dark:border-red-900 dark:text-red-300">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">{loadError}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchItems(filter)}
              leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Thử lại
            </Button>
          </div>
        )}

        {/* Cảnh báo lỗi thao tác duyệt/từ chối */}
        {actionError && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <span>{actionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400"
            >
              Đóng
            </button>
          </div>
        )}

        {/* Cảnh báo thiếu custom claim admin trên máy chủ */}
        {adminClaimMissing && (
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:border-amber-700 dark:text-amber-200">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Cảnh báo phân quyền Quản trị viên</p>
              <p className="text-xs mt-0.5">
                Tài khoản được nhận diện là admin ở giao diện nhưng máy chủ chưa cấp quyền (thiếu custom claim admin). Các thao tác duyệt hoặc xem ảnh thẻ sẽ bị máy chủ từ chối (HTTP 403). Hãy đăng xuất rồi đăng nhập lại để làm mới quyền.
              </p>
            </div>
          </div>
        )}

        {/* Trạng thái tải dữ liệu */}
        {isLoading ? (
          <div className="text-center py-16 bg-surface border border-surface-border rounded-2xl">
            <RefreshCw className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
            <p className="text-sm font-semibold text-text-secondary">Đang tải danh sách hồ sơ...</p>
          </div>
        ) : items.length === 0 && !loadError ? (
          <div className="text-center py-16 bg-surface border border-dashed border-surface-border rounded-2xl">
            <p className="text-sm font-semibold text-text-secondary">
              Không có hồ sơ nào trong trạng thái này.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {items.map((item) => (
              <div
                key={item.id}
                className="bg-surface border border-surface-border rounded-2xl p-5 shadow-card flex flex-col justify-between gap-4"
              >
                <div className="space-y-4">
                  {/* Header card: Tên & Tag */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-text-main">
                          {item.realName}
                        </h3>
                        {item.isEduEmail && (
                          <Badge variant="verified" className="text-[11px] py-0">
                            <Sparkles className="w-3 h-3 text-emerald-600 mr-0.5" />
                            Ưu tiên (.edu.vn)
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-text-muted mt-0.5">{item.userEmail}</p>
                    </div>

                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        item.status === "pending"
                          ? "bg-amber-100 text-amber-800 border border-amber-300"
                          : item.status === "approved"
                          ? "bg-green-100 text-green-800 border border-green-300"
                          : item.status === "rejected"
                          ? "bg-red-100 text-red-800 border border-red-300"
                          : "bg-slate-100 text-slate-800 border border-slate-300"
                      }`}
                    >
                      {item.status === "pending"
                        ? "Chờ duyệt"
                        : item.status === "approved"
                        ? "Đã duyệt"
                        : item.status === "rejected"
                        ? "Bị từ chối"
                        : "Hết hạn"}
                    </span>
                  </div>

                  {/* Khối so sánh 2 cột: Thông tin khai báo vs Ảnh thẻ thực tế */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2 border-t border-surface-border">
                    {/* Cột 1: Thông tin người dùng nhập */}
                    <div className="space-y-2 text-xs text-text-secondary bg-surface-muted p-3.5 rounded-xl border border-surface-border/50">
                      <div className="flex items-center gap-1.5 font-semibold text-text-main">
                        <School className="w-3.5 h-3.5 text-primary" />
                        <span>{item.schoolCode}</span>
                      </div>
                      <div>
                        <span className="text-text-muted">Khoa / Khóa: </span>
                        <span className="font-medium text-text-main">
                          {item.faculty || "N/A"} · {item.studentClass || "N/A"}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <IdCard className="w-3.5 h-3.5 text-text-muted" />
                        <span>4 số cuối MSSV: </span>
                        <span className="font-mono font-bold text-primary">
                          ***{item.studentIdLast4}
                        </span>
                      </div>
                      {item.isGraduating && (
                        <Badge variant="graduating" className="text-[10px]">
                          Sắp tốt nghiệp ra trường
                        </Badge>
                      )}
                    </div>

                    {/* Cột 2: Ảnh thẻ sinh viên tải lên */}
                    <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-900 border border-surface-border group">
                      {cardUrls[item.userId] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cardUrls[item.userId]}
                          alt="Ảnh thẻ SV"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain bg-black"
                        />
                      ) : item.hasCard ? (
                        <button
                          type="button"
                          onClick={() => loadCard(item)}
                          disabled={cardLoadingId !== null}
                          className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-xs text-slate-200 hover:bg-slate-800 transition-colors p-3 text-center"
                        >
                          <ImageIcon className="w-6 h-6 text-slate-400" />
                          <span>
                            {cardLoadingId === item.userId ? "Đang tải ảnh thẻ..." : "Bấm để xem ảnh thẻ"}
                          </span>
                        </button>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-slate-400 p-2 text-center">
                          Ảnh thẻ đã được xóa hoặc chưa có
                        </div>
                      )}
                      <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-[10px] text-white backdrop-blur-sm">
                        Mặt trước
                      </span>
                    </div>
                  </div>

                  {item.status === "rejected" && item.rejectReason && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 dark:bg-red-950/50 dark:border-red-800">
                      <p className="font-semibold">Lý do từ chối: {item.rejectReason}</p>
                      {item.rejectNote && <p className="mt-0.5 text-red-600">Ghi chú: {item.rejectNote}</p>}
                    </div>
                  )}
                </div>

                {/* Nút hành động cho Admin */}
                {item.status === "pending" && (
                  <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-surface-border">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-400 text-red-600 hover:bg-red-50"
                      disabled={processingId !== null}
                      leftIcon={<XCircle className="w-4 h-4" />}
                      onClick={() => {
                        setRejectTarget(item);
                        setRejectReason(REJECT_REASONS[0]);
                        setRejectNote("");
                      }}
                    >
                      Từ chối
                    </Button>
                    <Button
                      variant="verified"
                      size="sm"
                      disabled={processingId !== null}
                      isLoading={processingId === item.userId}
                      leftIcon={<CheckCircle className="w-4 h-4" />}
                      onClick={() => {
                        if (window.confirm(`Duyệt thẻ của ${item.realName} (MSSV ***${item.studentIdLast4})?`)) {
                          void handleAction(item, "approve");
                        }
                      }}
                    >
                      Duyệt Hợp Lệ
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Modal xác nhận Từ chối kèm lý do bắt buộc */}
        <Modal
          isOpen={rejectTarget !== null}
          onClose={() => setRejectTarget(null)}
          title="Từ chối hồ sơ xác minh thẻ"
          description="Bắt buộc chọn lý do rõ ràng để người dùng biết cách sửa và nộp lại."
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-text-main">
                Lý do từ chối (bắt buộc) *
              </label>
              <div className="space-y-2 text-xs">
                {REJECT_REASONS.map((reason) => (
                  <label
                    key={reason}
                    className="flex items-center gap-2 p-2.5 rounded-lg border border-surface-border hover:bg-surface-muted cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="rejectReason"
                      value={reason}
                      checked={rejectReason === reason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      className="text-primary focus:ring-primary"
                    />
                    <span className="font-medium text-text-main">{reason}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-text-main">
                Ghi chú thêm cho sinh viên (tùy chọn)
              </label>
              <textarea
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Ví dụ: Vui lòng chụp thẳng góc và đủ ánh sáng, không che mất phần ngày hết hạn..."
                className="w-full h-20 p-2.5 text-xs bg-surface border border-surface-border rounded-lg text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRejectTarget(null)}
              >
                Hủy
              </Button>
              <Button
                variant="danger"
                size="sm"
                isLoading={processingId !== null}
                disabled={processingId !== null || rejectReason.trim().length < 3}
                onClick={() => {
                  if (rejectTarget) {
                    void handleAction(rejectTarget, "reject", rejectReason, rejectNote);
                  }
                }}
              >
                Xác Nhận Từ Chối
              </Button>
            </div>
          </div>
        </Modal>
      </div>
  );
}

export default function AdminVerificationsPage() {
  return (
    <RequireAdmin>
      <AdminVerificationsContent />
    </RequireAdmin>
  );
}
