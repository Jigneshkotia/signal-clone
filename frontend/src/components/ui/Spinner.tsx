import { cn } from "@/lib/utils";

interface SpinnerProps {
  size?: number;
  className?: string;
}

/** Indeterminate ring spinner, inheriting `currentColor`. */
export function Spinner({ size = 18, className }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn("animate-spin", className)}
      role="status"
      aria-label="Loading"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        // A three-quarter arc reads as motion; a full ring would look static.
        strokeDasharray="42 14"
        opacity={0.9}
      />
    </svg>
  );
}
