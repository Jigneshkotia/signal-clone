"use client";

import { CheckIcon, InfoIcon, XIcon } from "@/components/icons";
import { useUiStore } from "@/store/uiStore";
import { cn } from "@/lib/utils";

/**
 * Signal's toasts are dark pills at the bottom-centre of the window, in both
 * themes -- they sit above the content rather than joining it.
 */
export function Toaster() {
  const toasts = useUiStore((state) => state.toasts);
  const dismiss = useUiStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "animate-toast-in pointer-events-auto flex max-w-[min(90vw,420px)] items-center gap-2.5",
            "rounded-lg bg-gray-80 px-4 py-2.5 text-[14px] leading-[20px] text-white",
            "shadow-[0_2px_16px_rgb(0_0_0/0.3)]",
          )}
        >
          {toast.tone === "success" && (
            <CheckIcon size={16} className="shrink-0 text-accent-green" />
          )}
          {toast.tone === "error" && (
            <InfoIcon size={16} className="shrink-0 text-accent-red" />
          )}
          <span className="min-w-0 flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
            className="-mr-1 shrink-0 rounded-full p-1 text-gray-25 hover:bg-white/10 hover:text-white"
          >
            <XIcon size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
