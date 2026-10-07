"use client";

import { cn } from "@/lib/utils";
import type { Reaction } from "@/types/api";

/** Signal's six quick reactions, in its own order. */
export const QUICK_REACTIONS = ["❤️", "👍", "👎", "😂", "😮", "😢"] as const;

interface ReactionPillsProps {
  reactions: Reaction[];
  currentUserId: string;
  onToggle: (emoji: string) => void;
  outgoing: boolean;
}

/**
 * Reaction pills sit just under the bubble, overlapping its bottom edge, with
 * one pill per distinct emoji carrying a count.
 */
export function ReactionPills({
  reactions,
  currentUserId,
  onToggle,
  outgoing,
}: ReactionPillsProps) {
  if (reactions.length === 0) return null;

  // Group by emoji, preserving first-reaction order.
  const groups = new Map<string, { count: number; mine: boolean }>();
  for (const reaction of reactions) {
    const entry = groups.get(reaction.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (reaction.user_id === currentUserId) entry.mine = true;
    groups.set(reaction.emoji, entry);
  }

  return (
    <div
      className={cn(
        // `relative z-10` matters: the bubble above is positioned, so a static
        // sibling overlapping it via the negative margin would be painted
        // underneath and clipped in half.
        "relative z-10 -mt-2 flex flex-wrap gap-1",
        outgoing ? "justify-end pr-1" : "justify-start pl-1",
      )}
    >
      {[...groups.entries()].map(([emoji, { count, mine }]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggle(emoji)}
          aria-label={`${emoji} ${count} ${mine ? "(including you)" : ""}`}
          aria-pressed={mine}
          className={cn(
            "flex items-center gap-1 rounded-full px-1.5 py-0.5",
            "border text-[12px] leading-[16px] transition-colors",
            "bg-[var(--surface-raised)]",
            mine
              ? "border-ultramarine text-ultramarine"
              : "border-[var(--border-subtle)] text-secondary hover:border-[var(--border-strong)]",
          )}
        >
          <span className="text-[13px] leading-none">{emoji}</span>
          {count > 1 && <span className="tabular-nums">{count}</span>}
        </button>
      ))}
    </div>
  );
}

interface ReactionBarProps {
  onSelect: (emoji: string) => void;
  current: string | null;
  outgoing: boolean;
}

/**
 * The floating picker that appears on bubble hover. Signal shows six emoji in a
 * rounded bar; the one you have already used is highlighted.
 */
export function ReactionBar({ onSelect, current, outgoing }: ReactionBarProps) {
  return (
    <div
      className={cn(
        "animate-popover-in absolute -top-9 z-20 flex items-center gap-0.5 rounded-full",
        "bg-[var(--surface-raised)] px-1.5 py-1",
        outgoing ? "right-0" : "left-0",
      )}
      style={{ boxShadow: "var(--shadow-popover)" }}
      role="group"
      aria-label="React to this message"
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onSelect(emoji)}
          aria-label={`React with ${emoji}`}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full text-[17px]",
            "transition-transform duration-75 hover:scale-125",
            current === emoji && "bg-ultramarine/15",
          )}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
