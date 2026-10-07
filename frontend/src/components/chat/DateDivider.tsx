import { formatDateDivider } from "@/lib/format";

/**
 * The day separator in the timeline. Signal centres a small uppercase-ish label
 * with no rule through it -- just the text floating on the background.
 */
export function DateDivider({ iso }: { iso: string }) {
  return (
    <div className="flex items-center justify-center py-3">
      <span className="text-[12px] font-medium leading-[16px] text-tertiary">
        {formatDateDivider(iso)}
      </span>
    </div>
  );
}
