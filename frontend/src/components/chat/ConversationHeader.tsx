"use client";

import {
  ArrowLeftIcon,
  MoreVerticalIcon,
  PhoneIcon,
  SearchIcon,
  VideoIcon,
} from "@/components/icons";
import { IconButton } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { formatPresence } from "@/lib/format";
import type { Conversation } from "@/types/api";

interface ConversationHeaderProps {
  conversation: Conversation;
  typistNames: string[];
  onOpenDetails: () => void;
  onBack: () => void;
  onUnsupported: (feature: string) => void;
}

/**
 * The 52px bar above the timeline ($header-height in Signal's variables).
 * Clicking the title opens the details panel, as it does in Signal.
 */
export function ConversationHeader({
  conversation,
  typistNames,
  onOpenDetails,
  onBack,
  onUnsupported,
}: ConversationHeaderProps) {
  const isGroup = conversation.type === "group";

  const subtitle = (() => {
    // Typing takes over the subtitle line while it lasts.
    if (typistNames.length === 1) {
      return isGroup ? `${typistNames[0]} is typing…` : "typing…";
    }
    if (typistNames.length > 1) return `${typistNames.length} people are typing…`;

    if (isGroup) {
      const count = conversation.members.length;
      return `${count} member${count === 1 ? "" : "s"}`;
    }
    return formatPresence(
      conversation.other_user?.is_online ?? false,
      conversation.other_user?.last_seen_at ?? null,
    );
  })();

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-app px-3">
      {/* Back out to the list on mobile, where only one pane is visible. */}
      <IconButton label="Back to chats" onClick={onBack} className="md:hidden">
        <ArrowLeftIcon size={20} />
      </IconButton>

      <button
        type="button"
        onClick={onOpenDetails}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-left hover:bg-[var(--surface-hover)]"
      >
        <Avatar
          name={conversation.title}
          color={conversation.avatar_color}
          url={conversation.avatar_url}
          size={32}
          isGroup={isGroup}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold leading-[20px] text-primary">
            {conversation.title}
          </span>
          {subtitle && (
            <span className="block truncate text-[12px] leading-[16px] text-secondary">
              {subtitle}
            </span>
          )}
        </span>
      </button>

      <IconButton
        label="Search in conversation"
        onClick={() => onUnsupported("Search within a conversation")}
        className="hidden sm:inline-flex"
      >
        <SearchIcon size={19} />
      </IconButton>
      <IconButton
        label="Start a video call"
        onClick={() => onUnsupported("Video calls")}
      >
        <VideoIcon size={19} />
      </IconButton>
      <IconButton
        label="Start a voice call"
        onClick={() => onUnsupported("Voice calls")}
      >
        <PhoneIcon size={19} />
      </IconButton>
      <IconButton label="Conversation details" onClick={onOpenDetails}>
        <MoreVerticalIcon size={19} />
      </IconButton>
    </header>
  );
}
