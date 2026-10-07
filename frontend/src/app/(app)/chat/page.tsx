"use client";

import { LockIcon } from "@/components/icons";

/**
 * Shown when no conversation is selected. Signal puts a large centred mark and
 * a short line about encryption here.
 */
export default function ChatIndexPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-app px-8">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--surface-hover)]">
        <LockIcon size={34} className="text-tertiary" />
      </div>
      <div className="text-center">
        <h2 className="text-[20px] font-semibold leading-[26px] text-primary">
          Select a chat
        </h2>
        <p className="mt-1 max-w-[320px] text-[13px] leading-[18px] text-secondary">
          Pick a conversation from the list, or start a new one. Messages are
          end-to-end encrypted (simulated).
        </p>
      </div>
    </div>
  );
}
