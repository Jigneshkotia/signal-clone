"use client";

import { useState } from "react";

import { EmojiIcon, ReplyIcon, TrashIcon } from "@/components/icons";
import { QuotedMessage } from "@/components/chat/QuotedMessage";
import { ReactionBar, ReactionPills } from "@/components/chat/Reactions";
import { StatusTicks } from "@/components/chat/StatusTicks";
import { Avatar } from "@/components/ui/Avatar";
import { formatFull, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/api";

interface MessageBubbleProps {
  message: Message;
  currentUserId: string;
  isGroup: boolean;
  /** True when the previous bubble is from the same sender, close in time. */
  groupedAbove: boolean;
  groupedBelow: boolean;
  onReply: (message: Message) => void;
  onReact: (messageId: string, emoji: string) => void;
  onDelete: (messageId: string) => void;
  onRetry: (clientId: string) => void;
  onJumpTo?: (messageId: string) => void;
}

/**
 * One message bubble.
 *
 * The geometry is Signal's, from `_modules.scss`:
 *
 *   border-radius  18px, collapsing to 4px on the side facing a grouped
 *                  neighbour, which is what makes a run of messages read as
 *                  one block with a single tail
 *   padding        8px vertical / 12px horizontal
 *   margin         6px between bubbles, 1px within a group
 *   max-width      min(306px, ...) narrow, 370px medium, 50vw wide
 */
export function MessageBubble({
  message,
  currentUserId,
  isGroup,
  groupedAbove,
  groupedBelow,
  onReply,
  onReact,
  onDelete,
  onRetry,
  onJumpTo,
}: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const outgoing = message.sender_id === currentUserId;
  const deleted = Boolean(message.deleted_at);
  const myReaction =
    message.reactions.find((r) => r.user_id === currentUserId)?.emoji ?? null;

  // Signal shows the avatar only on the last bubble of an incoming group, and
  // reserves the gutter on the others so the run stays aligned.
  const showAvatar = isGroup && !outgoing && !groupedBelow;
  const showSenderName = isGroup && !outgoing && !groupedAbove;

  const radius = {
    borderStartStartRadius: !outgoing && groupedAbove ? 4 : 18,
    borderEndStartRadius: !outgoing && groupedBelow ? 4 : 18,
    borderStartEndRadius: outgoing && groupedAbove ? 4 : 18,
    borderEndEndRadius: outgoing && groupedBelow ? 4 : 18,
  };

  const handleReact = (emoji: string) => {
    // Tapping the emoji you already used clears it, which the server also
    // enforces -- this just keeps the UI honest about what will happen.
    onReact(message.id, emoji);
    setPickerOpen(false);
  };

  return (
    <div
      className={cn(
        "group/message relative flex w-full gap-2 px-4",
        outgoing ? "flex-row-reverse" : "flex-row",
        groupedAbove ? "mt-px" : "mt-1.5",
        groupedBelow ? "mb-px" : "mb-1.5",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPickerOpen(false);
      }}
    >
      {/* Avatar gutter, reserved even when empty so grouped bubbles line up. */}
      {isGroup && !outgoing && (
        <div className="w-7 shrink-0 self-end">
          {showAvatar && message.sender && (
            <Avatar
              name={message.sender.display_name}
              color={message.sender.avatar_color}
              url={message.sender.avatar_url}
              size={28}
            />
          )}
        </div>
      )}

      <div
        className={cn(
          "relative flex min-w-0 flex-col",
          // Signal's own max-width ladder.
          "max-w-[min(306px,calc(100%-38px))] md:max-w-[370px] xl:max-w-[50vw]",
          outgoing ? "items-end" : "items-start",
        )}
      >
        {showSenderName && message.sender && (
          <span className="mb-0.5 pl-3 text-[13px] font-semibold leading-[18px] text-ultramarine">
            {message.sender.display_name}
          </span>
        )}

        {pickerOpen && !deleted && (
          <ReactionBar
            onSelect={handleReact}
            current={myReaction}
            outgoing={outgoing}
          />
        )}

        <div
          className={cn(
            // `min-w-0 max-w-full` is load-bearing: a quoted reply's truncated
            // text is `white-space: nowrap`, giving this a large min-content
            // width. Flex items default to `min-width: auto`, so without this
            // the bubble escapes the column's max-width and runs off-screen.
            "relative min-w-0 max-w-full overflow-hidden px-3 py-2",
            outgoing
              ? "bg-bubble-outgoing text-white"
              : "bg-bubble-incoming text-on-bubble-incoming",
            deleted && "bg-transparent italic ring-1 ring-[var(--border-strong)]",
            deleted && (outgoing ? "text-primary" : "text-secondary"),
            message.failed && "ring-1 ring-accent-red",
          )}
          style={radius}
        >
          {message.reply_to && !deleted && (
            <QuotedMessage
              quote={message.reply_to}
              outgoing={outgoing}
              onClick={
                onJumpTo ? () => onJumpTo(message.reply_to!.id) : undefined
              }
            />
          )}

          {/*
            Bubble text and the timestamp share a line when they fit. The
            footer is floated so a long final word wraps around it rather than
            leaving a gap, which is how Signal avoids ragged bubble bottoms.
          */}
          <p className="whitespace-pre-wrap break-words text-[14px] leading-[20px]">
            {deleted ? "This message was deleted" : message.body}
            <span className="pointer-events-none inline-block w-[64px] select-none" />
          </p>

          <span
            className={cn(
              "absolute bottom-1.5 right-2.5 flex items-center gap-1",
              "text-[11px] leading-[14px]",
              outgoing ? "text-white/75" : "text-tertiary",
            )}
            title={formatFull(message.created_at)}
          >
            {message.edited_at && <span className="italic">edited</span>}
            <span className="tabular-nums">{formatTime(message.created_at)}</span>
            {outgoing && !deleted && (
              <button
                type="button"
                onClick={() =>
                  message.failed && message.client_id
                    ? onRetry(message.client_id)
                    : undefined
                }
                className={cn(
                  "flex items-center",
                  message.failed ? "cursor-pointer" : "cursor-default",
                )}
                tabIndex={message.failed ? 0 : -1}
                aria-label={message.failed ? "Retry sending" : undefined}
              >
                <StatusTicks status={message.status} failed={message.failed} />
              </button>
            )}
          </span>
        </div>

        <ReactionPills
          reactions={message.reactions}
          currentUserId={currentUserId}
          onToggle={handleReact}
          outgoing={outgoing}
        />
      </div>

      {/* Hover actions, in the gutter beside the bubble. */}
      {hovered && !deleted && !message.pending && (
        <div
          className={cn(
            "flex items-center gap-0.5 self-center",
            outgoing ? "flex-row-reverse" : "flex-row",
          )}
        >
          <HoverAction
            label="React"
            onClick={() => setPickerOpen((open) => !open)}
          >
            <EmojiIcon size={15} />
          </HoverAction>
          <HoverAction label="Reply" onClick={() => onReply(message)}>
            <ReplyIcon size={15} />
          </HoverAction>
          {outgoing && (
            <HoverAction
              label="Delete for everyone"
              onClick={() => onDelete(message.id)}
            >
              <TrashIcon size={15} />
            </HoverAction>
          )}
        </div>
      )}
    </div>
  );
}

function HoverAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-full",
        "text-tertiary transition-colors",
        "hover:bg-[var(--surface-hover)] hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}
