import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import type { MessageStatus } from "@/types/api";

interface StatusTicksProps {
  status: MessageStatus;
  failed?: boolean;
  className?: string;
}

/**
 * The delivery indicator in an outgoing bubble's footer.
 *
 * Signal draws these in white on the ultramarine bubble and distinguishes read
 * by *opacity*, not hue -- there are no blue ticks as in WhatsApp. So:
 *
 *   sending    spinner
 *   sent       one tick,  partially transparent
 *   delivered  two ticks, partially transparent
 *   read       two ticks, fully opaque
 */
export function StatusTicks({ status, failed, className }: StatusTicksProps) {
  if (failed) {
    return (
      <span
        className={cn("text-[11px] font-medium leading-[14px]", className)}
        title="Message not sent -- click to retry"
      >
        !
      </span>
    );
  }

  if (status === "sending") {
    return (
      <Spinner
        size={11}
        className={cn("opacity-70", className)}
        aria-label="Sending"
      />
    );
  }

  const isRead = status === "read";
  const isDouble = status === "delivered" || isRead;

  return (
    <svg
      width={isDouble ? 16 : 11}
      height={11}
      viewBox={isDouble ? "0 0 16 11" : "0 0 11 11"}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(isRead ? "opacity-100" : "opacity-65", className)}
      role="img"
      aria-label={
        status === "sent" ? "Sent" : status === "delivered" ? "Delivered" : "Read"
      }
    >
      <path d="M1 6.1 3.6 8.8 8.7 2.2" />
      {isDouble && <path d="M6.6 6.1 9.2 8.8 14.3 2.2" />}
    </svg>
  );
}
