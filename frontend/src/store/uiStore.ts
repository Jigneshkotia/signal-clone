"use client";

/**
 * Presentation state: theme, toasts, modals, and the mobile pane.
 *
 * Kept apart from chat data so a toast or a modal never re-renders the timeline.
 */

import { create } from "zustand";

import { uuid } from "@/lib/utils";

export type Theme = "light" | "dark" | "system";

export type ModalKind =
  | "new-chat"
  | "new-group"
  | "add-contact"
  | "settings"
  | "group-details"
  | "safety-number"
  | "coming-soon"
  | null;

export interface Toast {
  id: string;
  message: string;
  tone: "neutral" | "success" | "error";
}

const THEME_KEY = "signal-clone.theme";
const TOAST_DURATION = 3_600;

interface UiState {
  theme: Theme;
  modal: ModalKind;
  /** Free-form payload for the open modal (a feature name, a conversation id). */
  modalPayload: unknown;
  toasts: Toast[];
  /** On narrow screens only one pane shows at a time. */
  mobilePane: "list" | "chat";

  setTheme: (theme: Theme) => void;
  initTheme: () => void;
  openModal: (kind: Exclude<ModalKind, null>, payload?: unknown) => void;
  closeModal: () => void;
  toast: (message: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: string) => void;
  setMobilePane: (pane: "list" | "chat") => void;
}

/** Apply the theme to <html> so the `.dark` variant takes effect. */
function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;

  const prefersDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  document.documentElement.classList.toggle("dark", prefersDark);
  // Lets the browser paint native controls and scrollbars to match.
  document.documentElement.style.colorScheme = prefersDark ? "dark" : "light";
}

export const useUiStore = create<UiState>((set, get) => ({
  theme: "system",
  modal: null,
  modalPayload: null,
  toasts: [],
  mobilePane: "list",

  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  },

  /** Read the stored preference and start following the OS when set to system. */
  initTheme: () => {
    let stored: Theme = "system";
    try {
      const value = window.localStorage.getItem(THEME_KEY);
      if (value === "light" || value === "dark" || value === "system") {
        stored = value;
      }
    } catch {
      /* ignore */
    }

    set({ theme: stored });
    applyTheme(stored);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (get().theme === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
  },

  openModal: (kind, payload = null) =>
    set({ modal: kind, modalPayload: payload }),

  closeModal: () => set({ modal: null, modalPayload: null }),

  toast: (message, tone = "neutral") => {
    const id = uuid();
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    setTimeout(() => get().dismissToast(id), TOAST_DURATION);
  },

  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  setMobilePane: (pane) => set({ mobilePane: pane }),
}));
