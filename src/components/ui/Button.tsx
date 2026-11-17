import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "secondary"
    | "outline"
    | "ghost"
    | "urgent"
    | "verified"
    | "danger";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      children,
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none select-none touch-target";

    const variants = {
      primary:
        "bg-primary text-white hover:bg-primary-hover focus-visible:ring-primary shadow-subtle",
      secondary:
        "bg-surface-muted text-text-main hover:bg-surface-border border border-surface-border",
      outline:
        "border border-primary text-primary hover:bg-primary-light dark:hover:bg-primary/10",
      ghost:
        "text-text-secondary hover:text-text-main hover:bg-surface-muted",
      urgent:
        "bg-urgent-solid text-white hover:bg-amber-700 shadow-subtle focus-visible:ring-amber-500",
      verified:
        "bg-verified-border text-white hover:bg-green-700 shadow-subtle",
      danger:
        "bg-danger-solid text-white hover:bg-red-700 shadow-subtle",
    };

    const sizes = {
      sm: "h-9 px-3 text-xs gap-1.5",
      md: "h-11 px-4 text-sm gap-2",
      lg: "h-12 px-6 text-base gap-2.5",
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-current" />
        ) : (
          leftIcon
        )}
        <span>{children}</span>
        {!isLoading && rightIcon}
      </button>
    );
  }
);
Button.displayName = "Button";
