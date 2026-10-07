/**
 * Signal's twelve conversation colours, used for generated avatars.
 *
 * Mirrors `backend/app/core/colors.py`. The backend assigns a colour at
 * registration; `colorFor` exists for anything rendered before the server has
 * weighed in (an optimistic group, a search result without a stored colour).
 */

import type { AvatarColor } from "@/types/api";

export const CONVERSATION_COLORS: Record<AvatarColor, string> = {
  crimson: "#cf163e",
  vermilion: "#c73f0a",
  burlap: "#6f6a58",
  forest: "#3b7845",
  wintergreen: "#1d8663",
  teal: "#077d92",
  blue: "#336ba3",
  indigo: "#6058ca",
  violet: "#9932c8",
  plum: "#aa377a",
  taupe: "#8f616a",
  steel: "#71717f",
  ultramarine: "#2c6bed",
};

const COLOR_NAMES = Object.keys(CONVERSATION_COLORS).filter(
  (name): name is AvatarColor => name !== "ultramarine",
);

/** Deterministic colour for an id, so avatars stay stable across reloads. */
export function colorFor(key: string): AvatarColor {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    // Cheap string hash; `| 0` keeps it in int32 range.
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return COLOR_NAMES[Math.abs(hash) % COLOR_NAMES.length];
}

export function hexFor(color: AvatarColor | string | null | undefined): string {
  if (!color) return CONVERSATION_COLORS.steel;
  return CONVERSATION_COLORS[color as AvatarColor] ?? CONVERSATION_COLORS.steel;
}

/** First letters of the first and last word, as Signal renders them. */
export function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "#";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
