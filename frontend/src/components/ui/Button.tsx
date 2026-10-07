"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

/** Signal uses fully rounded pill buttons throughout. */
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-ultramarine text-white hover:bg-ultramarine-dark active:bg-ultramarine-dark",
  secondary:
    "bg-[var(--surface-active)] text-primary hover:bg-[var(--surface-hover)]",
  ghost: "bg-transparent text-primary hover:bg-[var(--surface-hover)]",
  danger: "bg-transparent text-accent-red hover:bg-accent-red/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px]",
  md: "h-9 px-5 text-[14px]",
  lg: "h-11 px-6 text-[15px]",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium",
        "transition-colors duration-100",
        "disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading && <Spinner size={15} />}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
  active?: boolean;
}

/** A circular icon-only button. `label` is required -- it becomes the a11y name. */
export function IconButton({
  label,
  active = false,
  className,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
        "text-secondary transition-colors duration-100",
        "hover:bg-[var(--surface-hover)] hover:text-primary",
        "disabled:pointer-events-none disabled:opacity-45",
        active && "bg-[var(--surface-active)] text-primary",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
