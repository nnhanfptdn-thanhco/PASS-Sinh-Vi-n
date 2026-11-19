import * as React from "react";
import { cn } from "@/lib/utils";
import { Zap, CheckCircle2, Truck, MapPin, GraduationCap } from "lucide-react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?:
    | "urgent"      // "⚡ Pass trong ngày"
    | "verified"    // "✓ Đã xác minh"
    | "ship"        // "🚚 Có ship"
    | "pickup"      // "📍 Tự đến lấy"
    | "sameSchool"  // "🎓 Cùng trường"
    | "near"        // "📍 Cùng phường/xã"
    | "graduating"  // "Sắp tốt nghiệp"
    | "success"
    | "reserved"
    | "danger"
    | "default"
    | "outline";
}

export function Badge({
  className,
  variant = "default",
  children,
  ...props
}: BadgeProps) {
  const baseStyles =
    "inline-flex items-center gap-1 font-semibold rounded-full px-2.5 py-0.5 text-xs transition-colors select-none";

  const variants = {
    urgent:
      "bg-urgent-bg text-urgent-text border border-urgent-border/40 font-bold animate-pulse",
    verified:
      "bg-verified-bg text-verified-text border border-verified-border/40",
    ship:
      "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800",
    pickup:
      "bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
    sameSchool:
      "bg-primary-light text-primary border border-primary/20 font-medium",
    near:
      "bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    graduating:
      "bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800",
    success:
      "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
    reserved:
      "bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
    danger:
      "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800",
    default:
      "bg-surface-muted text-text-secondary border border-surface-border",
    outline:
      "border border-surface-border text-text-secondary bg-transparent",
  };

  const icons = {
    urgent: <Zap className="w-3 h-3 fill-current text-urgent-solid" />,
    verified: <CheckCircle2 className="w-3 h-3 text-verified-border" />,
    ship: <Truck className="w-3 h-3" />,
    pickup: <MapPin className="w-3 h-3" />,
    sameSchool: <GraduationCap className="w-3 h-3" />,
    near: <MapPin className="w-3 h-3" />,
    graduating: <GraduationCap className="w-3 h-3" />,
    success: null,
    reserved: null,
    danger: null,
    default: null,
    outline: null,
  };

  return (
    <span className={cn(baseStyles, variants[variant], className)} {...props}>
      {icons[variant]}
      {children}
    </span>
  );
}
