"use client";

import * as React from "react";
import { authFetch } from "@/lib/firebase/client";
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
} from "lucide-react";

interface VerificationItem {
  id: string;
  userId: string;
  userEmail: string;
  realName: string;
  schoolCode: string;
  faculty?: string;
  studentClass?: string;
  studentIdLast4: string;
  status: "pending" | "approved" | "rejected";
  isEduEmail?: boolean;
  isGraduating?: boolean;
  cardImagePreviewUrl?: string;
  rejectReason?: string;
  rejectNote?: string;
  createdAt?: { seconds: number };
}

export default function AdminVerificationsPage() {
  const [items, setItems] = React.useState<VerificationItem[]>([]);
  const [filter, setFilter] = React.useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [selectedItem, setSelectedItem] = React.useState<VerificationItem | null>(null);

  // Reject Modal state
  const [isRejectModalOpen, setIsRejectModalOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("Ảnh mờ, không đọc được thông tin");
  const [rejectNote, setRejectNote] = React.useState("");
  const [isProcessing, setIsProcessing] = React.useState(false);

  const fetchItems = async () => {
    try {
      const res = await authFetch("/api/admin/verifications");
      if (res.ok) {
        const data = await res.json();
        if (data.items) {
          setItems(data.items);
        }
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    }
  };

  React.useEffect(() => {
    fetchItems();
  }, []);

  const handleAction = async (action: "approve" | "reject") => {
    if (!selectedItem) return;
    setIsProcessing(true);

    try {
      const res = await authFetch("/api/admin/verifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedItem.userId,
          action,
          reason: action === "reject" ? rejectReason : undefined,
          note: action === "reject" ? rejectNote : undefined,
        }),
      });

      if (res.ok) {
        setItems((prev) =>
          prev.map((it) =>
            it.userId === selectedItem.userId
              ? {
                  ...it,
                  status: action === "approve" ? "approved" : "rejected",
                  rejectReason: action === "reject" ? rejectReason : undefined,
                }
              : it
          )
        );
        setIsRejectModalOpen(false);
        setSelectedItem(null);
      }
    } catch (err) {
      console.error("Lỗi duyệt thẻ:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredItems = items.filter((it) => {
    if (filter === "all") return true;
    return it.status === filter;
  });

  return (
    <RequireAdmin>
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
          {(["pending", "approved", "rejected", "all"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all ${
                filter === tab
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-secondary hover:text-text-main"
              }`}
            >
              {tab === "pending"
                ? "Chờ duyệt"
                : tab === "approved"
                ? "Đã duyệt"
                : tab === "rejected"
                ? "Từ chối"
                : "Tất cả"}
            </button>
          ))}
        </div>
      </div>

      {/* Danh sách thẻ sinh viên */}
      {filteredItems.length === 0 ? (
        <div className="text-center py-16 bg-surface border border-dashed border-surface-border rounded-2xl">
          <p className="text-sm font-semibold text-text-secondary">
            Không có hồ sơ nào trong trạng thái này.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredItems.map((item) => (
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
                        : "bg-red-100 text-red-800 border border-red-300"
                    }`}
                  >
                    {item.status === "pending"
                      ? "Chờ duyệt"
                      : item.status === "approved"
                      ? "Đã duyệt"
                      : "Bị từ chối"}
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
                    {item.cardImagePreviewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.cardImagePreviewUrl}
                        alt="Ảnh thẻ SV"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
                        Chưa có ảnh thẻ
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
                    leftIcon={<XCircle className="w-4 h-4" />}
                    onClick={() => {
                      setSelectedItem(item);
                      setIsRejectModalOpen(true);
                    }}
                  >
                    Từ chối
                  </Button>
                  <Button
                    variant="verified"
                    size="sm"
                    leftIcon={<CheckCircle className="w-4 h-4" />}
                    onClick={() => {
                      setSelectedItem(item);
                      handleAction("approve");
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
        isOpen={isRejectModalOpen}
        onClose={() => setIsRejectModalOpen(false)}
        title="Từ chối hồ sơ xác minh thẻ"
        description="Bắt buộc chọn lý do rõ ràng để người dùng biết cách sửa và nộp lại."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-bold text-text-main">
              Lý do từ chối (bắt buộc) *
            </label>
            <div className="space-y-2 text-xs">
              {[
                "Ảnh mờ, không đọc được thông tin",
                "Thẻ sinh viên đã hết hạn hiệu lực",
                "Tên trên thẻ không khớp họ tên khai báo",
                "Thẻ không hợp lệ / không phải thẻ sinh viên chính quy",
              ].map((reason) => (
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
              onClick={() => setIsRejectModalOpen(false)}
            >
              Hủy
            </Button>
            <Button
              variant="danger"
              size="sm"
              isLoading={isProcessing}
              onClick={() => handleAction("reject")}
            >
              Xác Nhận Từ Chối
            </Button>
          </div>
        </div>
      </Modal>
    </div>
    </RequireAdmin>
  );
}
