import { cn } from "@/lib/utils";
import type { QuotedMessage as QuotedMessageType } from "@/types/api";

interface QuotedMessageProps {
  quote: QuotedMessageType;
  /** Outgoing bubbles need a lighter treatment to read on ultramarine. */
  outgoing: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * The quoted block Signal renders inside a reply: a thick accent bar on the
 * leading edge, the original author's name, and a one-line snippet.
 */
export function QuotedMessage({
  quote,
  outgoing,
  onClick,
  className,
}: QuotedMessageProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "mb-1 flex w-full items-stretch gap-2 overflow-hidden rounded-[10px] text-left",
        outgoing ? "bg-black/15" : "bg-black/[0.06] dark:bg-white/[0.08]",
        onClick && "cursor-pointer",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "w-[3px] shrink-0 rounded-full",
          outgoing ? "bg-white/70" : "bg-ultramarine",
        )}
      />
      <span className="min-w-0 flex-1 py-1.5 pr-2.5">
        <span
          className={cn(
            "block truncate text-[13px] font-semibold leading-[18px]",
            outgoing ? "text-white" : "text-ultramarine",
          )}
        >
          {quote.sender_name}
        </span>
        <span
          className={cn(
            "block truncate text-[13px] leading-[18px]",
            outgoing ? "text-white/80" : "text-secondary",
            quote.is_deleted && "italic",
          )}
        >
          {quote.is_deleted ? "This message was deleted" : quote.body}
        </span>
      </span>
    </button>
  );
}
