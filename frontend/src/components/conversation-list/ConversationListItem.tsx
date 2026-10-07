"use client";

import { BellOffIcon, PinIcon } from "@/components/icons";
import { StatusTicks } from "@/components/chat/StatusTicks";
import { Avatar } from "@/components/ui/Avatar";
import { formatListTimestamp } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/api";

interface ConversationListItemProps {
  conversation: Conversation;
  currentUserId: string;
  selected: boolean;
  typing: boolean;
  onSelect: () => void;
}

/**
 * One row in the chat list.
 *
 * Geometry from Signal's `ListTile.scss`: 6px block / 14px inline padding, a
 * 48px avatar, 14px/20px title, 12px/17px subtitle, and the distinctive
 * elliptical `border-radius: 20px / 12px` on the hover and selection fill.
 */
export function ConversationListItem({
  conversation,
  currentUserId,
  selected,
  typing,
  onSelect,
}: ConversationListItemProps) {
  const { last_message: last, unread_count: unread } = conversation;
  const isGroup = conversation.type === "group";
  const hasUnread = unread > 0;

  const preview = (() => {
    if (typing) return "typing…";
    if (!last) return "No messages yet";
    if (last.deleted_at) return "This message was deleted";
    if (last.type === "system") return last.body;

    // Group previews are prefixed with the sender, as Signal does.
    const mine = last.sender_id === currentUserId;
    const name = mine ? "You" : last.sender?.display_name?.split(" ")[0];
    return isGroup && name ? `${name}: ${last.body}` : last.body;
  })();

  // The tick only appears when the newest message is one you sent.
  const showTicks =
    !typing && last?.sender_id === currentUserId && last.type === "text" && !last.deleted_at;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 px-3.5 py-1.5 text-left",
        // Signal insets the fill with a transparent border rather than margin.
        "mx-1 w-[calc(100%-0.5rem)] rounded-[20px_/_12px]",
        "transition-colors duration-75",
        selected
          ? "bg-[var(--surface-selected)]"
          : "hover:bg-[var(--surface-hover)]",
      )}
    >
      <Avatar
        name={conversation.title}
        color={conversation.avatar_color}
        url={conversation.avatar_url}
        size={48}
        isGroup={isGroup}
        isOnline={conversation.other_user?.is_online}
        showPresence
      />

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[14px] leading-[20px] text-primary",
              hasUnread && "font-semibold",
            )}
          >
            {conversation.title}
          </span>
          <span
            className={cn(
              "shrink-0 text-[12px] leading-[16px] tabular-nums",
              hasUnread ? "font-medium text-ultramarine" : "text-tertiary",
            )}
          >
            {formatListTimestamp(conversation.last_message_at)}
          </span>
        </span>

        <span className="mt-0.5 flex items-center gap-1.5">
          {showTicks && (
            <StatusTicks
              status={last.status}
              className="shrink-0 text-tertiary"
            />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[12px] leading-[17px]",
              typing
                ? "italic text-ultramarine"
                : hasUnread
                  ? "text-primary"
                  : "text-secondary",
            )}
          >
            {preview}
          </span>

          {conversation.is_pinned && (
            <PinIcon size={13} className="shrink-0 text-tertiary" />
          )}
          {conversation.is_muted && (
            <BellOffIcon size={13} className="shrink-0 text-tertiary" />
          )}

          {hasUnread && (
            <span
              className={cn(
                "flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5",
                "bg-ultramarine text-[11px] font-semibold leading-none text-white tabular-nums",
              )}
              aria-label={`${unread} unread messages`}
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
