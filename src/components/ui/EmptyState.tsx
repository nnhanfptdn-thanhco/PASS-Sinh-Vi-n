import * as React from "react";
import { PackageOpen, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Link from "next/link";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  description?: string;
  actionText?: string;
  actionHref?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon = <PackageOpen className="w-12 h-12 text-primary" />,
  title = "Chưa có món đồ nào quanh khu vực của bạn",
  description = "Hãy là người đầu tiên đăng pass đồ cũ hoặc giáo trình cho các bạn sinh viên cùng trường nhé!",
  actionText = "Đăng món đồ đầu tiên của trường bạn",
  actionHref = "/listings/new",
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-surface border border-dashed border-surface-border rounded-2xl max-w-md mx-auto my-6 space-y-4">
      <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center">
        {icon}
      </div>

      <div className="space-y-1.5">
        <h3 className="text-base font-bold text-text-main">{title}</h3>
        <p className="text-xs text-text-secondary leading-relaxed max-w-sm">
          {description}
        </p>
      </div>

      {actionHref ? (
        <Link href={actionHref}>
          <Button
            variant="primary"
            size="md"
            leftIcon={<PlusCircle className="w-4 h-4" />}
          >
            {actionText}
          </Button>
        </Link>
      ) : onAction ? (
        <Button
          onClick={onAction}
          variant="primary"
          size="md"
          leftIcon={<PlusCircle className="w-4 h-4" />}
        >
          {actionText}
        </Button>
      ) : null}
    </div>
  );
}
