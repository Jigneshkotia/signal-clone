"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { XIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Signal's dialogs are narrow; `lg` is for the settings sheet. */
  width?: "sm" | "md" | "lg";
  className?: string;
}

const WIDTHS = {
  sm: "max-w-[380px]",
  md: "max-w-[440px]",
  lg: "max-w-[560px]",
} as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape to dismiss, and lock the page behind the dialog.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Move focus into the dialog so keyboard users are not left behind it.
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        "input, textarea, button, [tabindex]:not([tabindex='-1'])",
      );
      focusable?.focus();
    }, 20);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in"
      style={{ backgroundColor: "var(--overlay-scrim)" }}
      onMouseDown={(event) => {
        // Only a click on the scrim itself closes, never a drag out of the panel.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "flex w-full flex-col overflow-hidden rounded-xl bg-[var(--surface-raised)]",
          "max-h-[min(85vh,720px)] animate-popover-in",
          WIDTHS[width],
          className,
        )}
        style={{ boxShadow: "var(--shadow-popover)" }}
      >
        {title && (
          <header className="flex items-start gap-3 px-5 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-[18px] font-semibold leading-[25px] text-primary">
                {title}
              </h2>
              {description && (
                <p className="mt-1 text-[13px] leading-[18px] text-secondary">
                  {description}
                </p>
              )}
            </div>
            <IconButton label="Close" onClick={onClose} className="-mr-1.5 -mt-1">
              <XIcon size={19} />
            </IconButton>
          </header>
        )}

        <div className="scrollbar-signal min-h-0 flex-1 overflow-y-auto px-5 py-1">
          {children}
        </div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 px-5 pb-4 pt-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
