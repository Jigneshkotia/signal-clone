import type { ReactNode } from "react";

/**
 * A centred grey notice: group creation, membership changes, timer updates.
 * Signal styles these as plain centred text, not as a bubble.
 */
export function SystemMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center px-10 py-2">
      <p className="text-center text-[12px] leading-[16px] text-tertiary">
        {children}
      </p>
    </div>
  );
}
