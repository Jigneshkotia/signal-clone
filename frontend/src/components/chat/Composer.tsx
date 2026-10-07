"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  EmojiIcon,
  MicIcon,
  PaperclipIcon,
  SendIcon,
  XIcon,
} from "@/components/icons";
import { IconButton } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/api";

interface ComposerProps {
  replyTo: Message | null;
  onCancelReply: () => void;
  onSend: (body: string, replyToId: string | null) => void;
  onTyping: (isTyping: boolean) => void;
  onUnsupported: (feature: string) => void;
  disabled?: boolean;
}

/** Stop broadcasting "typing" this long after the last keystroke. */
const TYPING_IDLE = 2_500;
const MAX_TEXTAREA_HEIGHT = 160;

/** A small palette for the composer's emoji button. */
const EMOJI_PALETTE = [
  "😀", "😂", "🙂", "😉", "😍", "😎", "🤔", "😅",
  "😭", "😡", "👍", "👎", "🙏", "👏", "🔥", "🎉",
  "❤️", "💙", "✨", "⭐", "✅", "❌", "💯", "👀",
];

export function Composer({
  replyTo,
  onCancelReply,
  onSend,
  onTyping,
  onUnsupported,
  disabled = false,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingRef = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stopTyping = useCallback(() => {
    if (!typingRef.current) return;
    typingRef.current = false;
    onTyping(false);
  }, [onTyping]);

  /*
   * No draft-reset effect here: the conversation view is keyed by conversation
   * id, so switching threads remounts this component and the `useState`
   * initialisers above are the reset.
   *
   * What does still need an effect is the courtesy "stopped typing" frame on
   * the way out, which belongs in a cleanup rather than a reset.
   */
  useEffect(() => {
    textareaRef.current?.focus();
    return () => {
      stopTyping();
    };
  }, [stopTyping]);

  // Focus the box when a reply is started.
  useEffect(() => {
    if (replyTo) textareaRef.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  /** Grow with the content up to a cap, then scroll inside. */
  const resize = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, []);

  useEffect(resize, [value, resize]);

  const handleChange = (next: string) => {
    setValue(next);

    if (next.trim() && !typingRef.current) {
      typingRef.current = true;
      onTyping(true);
    }

    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (next.trim()) {
      idleTimer.current = setTimeout(stopTyping, TYPING_IDLE);
    } else {
      stopTyping();
    }
  };

  const submit = () => {
    const body = value.trim();
    if (!body || disabled) return;

    onSend(body, replyTo?.id ?? null);
    setValue("");
    setEmojiOpen(false);
    stopTyping();
    if (idleTimer.current) clearTimeout(idleTimer.current);
    onCancelReply();
    // Reset the height now rather than waiting for the effect, so the box does
    // not visibly snap back a frame later.
    requestAnimationFrame(resize);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline, as in Signal.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "Escape" && replyTo) {
      event.preventDefault();
      onCancelReply();
    }
  };

  const insertEmoji = (emoji: string) => {
    const element = textareaRef.current;
    if (!element) {
      handleChange(value + emoji);
      return;
    }
    // Insert at the caret rather than appending.
    const start = element.selectionStart ?? value.length;
    const end = element.selectionEnd ?? value.length;
    const next = value.slice(0, start) + emoji + value.slice(end);
    handleChange(next);
    requestAnimationFrame(() => {
      element.focus();
      const caret = start + emoji.length;
      element.setSelectionRange(caret, caret);
    });
  };

  const hasText = value.trim().length > 0;

  return (
    <div className="shrink-0 border-t border-[var(--border-subtle)] bg-app px-3 py-2.5">
      {replyTo && (
        <div className="mb-2 flex items-stretch gap-2 overflow-hidden rounded-lg bg-[var(--surface-hover)]">
          <span className="w-[3px] shrink-0 rounded-full bg-ultramarine" />
          <div className="min-w-0 flex-1 py-1.5">
            <p className="truncate text-[13px] font-semibold leading-[18px] text-ultramarine">
              Replying to {replyTo.sender?.display_name ?? "yourself"}
            </p>
            <p className="truncate text-[13px] leading-[18px] text-secondary">
              {replyTo.body}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-full text-tertiary hover:bg-[var(--surface-active)] hover:text-primary"
          >
            <XIcon size={15} />
          </button>
        </div>
      )}

      {emojiOpen && (
        <div
          className="animate-popover-in mb-2 grid grid-cols-8 gap-1 rounded-xl bg-[var(--surface-raised)] p-2"
          style={{ boxShadow: "var(--shadow-popover)" }}
        >
          {EMOJI_PALETTE.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => insertEmoji(emoji)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[19px] hover:bg-[var(--surface-hover)]"
              aria-label={`Insert ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1">
        <IconButton
          label="Attach a file"
          onClick={() => onUnsupported("Attachments")}
          className="mb-0.5"
        >
          <PaperclipIcon size={19} />
        </IconButton>

        <div className="flex min-w-0 flex-1 items-end rounded-[18px] bg-[var(--surface-input)] px-3 py-1.5">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={disabled}
            onChange={(event) => handleChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={stopTyping}
            placeholder="Message"
            aria-label="Message"
            className={cn(
              "scrollbar-none max-h-40 min-h-[24px] w-full resize-none bg-transparent",
              "text-[14px] leading-[20px] text-primary placeholder:text-tertiary",
              "outline-none",
            )}
          />
          <button
            type="button"
            onClick={() => setEmojiOpen((open) => !open)}
            aria-label="Emoji"
            aria-expanded={emojiOpen}
            className={cn(
              "mb-0.5 ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
              "text-tertiary hover:text-primary",
              emojiOpen && "text-ultramarine",
            )}
          >
            <EmojiIcon size={19} />
          </button>
        </div>

        {/*
          Signal swaps the microphone for a send button the moment there is
          text -- the two never appear together.
        */}
        {hasText ? (
          <button
            type="button"
            onClick={submit}
            disabled={disabled}
            aria-label="Send"
            className={cn(
              "mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              "bg-ultramarine text-white transition-colors hover:bg-ultramarine-dark",
              "disabled:opacity-50",
            )}
          >
            <SendIcon size={18} />
          </button>
        ) : (
          <IconButton
            label="Record a voice message"
            onClick={() => onUnsupported("Voice messages")}
            className="mb-0.5"
          >
            <MicIcon size={19} />
          </IconButton>
        )}
      </div>
    </div>
  );
}
