"use client";

import { useMemo, useState } from "react";

import { ConversationListItem } from "@/components/conversation-list/ConversationListItem";
import { PencilIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/Button";
import { SearchInput } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/api";

type Filter = "all" | "unread";

interface LeftPaneProps {
  conversations: Conversation[];
  currentUserId: string;
  activeId: string | null;
  typingByConversation: Record<string, boolean>;
  loading: boolean;
  connectionLabel: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}

export function LeftPane({
  conversations,
  currentUserId,
  activeId,
  typingByConversation,
  loading,
  connectionLabel,
  onSelect,
  onNewChat,
}: LeftPaneProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();

    return conversations.filter((conversation) => {
      if (filter === "unread" && conversation.unread_count === 0) return false;
      if (!term) return true;

      // Match the title, the last message, or any member's name, so searching
      // finds a group by someone in it.
      if (conversation.title.toLowerCase().includes(term)) return true;
      if (conversation.last_message?.body.toLowerCase().includes(term)) return true;
      return conversation.members.some((member) =>
        member.user.display_name.toLowerCase().includes(term),
      );
    });
  }, [conversations, query, filter]);

  const unreadTotal = conversations.reduce((sum, c) => sum + c.unread_count, 0);

  return (
    <div className="flex h-full w-full flex-col bg-pane">
      <header className="flex h-[52px] shrink-0 items-center gap-2 px-4">
        <h1 className="flex-1 text-[20px] font-semibold leading-[26px] text-primary">
          Chats
        </h1>
        <IconButton label="New chat" onClick={onNewChat}>
          <PencilIcon size={19} />
        </IconButton>
      </header>

      <div className="shrink-0 px-3 pb-2">
        <SearchInput value={query} onChange={setQuery} />
      </div>

      <div className="flex shrink-0 items-center gap-2 px-3.5 pb-2">
        <FilterTab
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label="All"
        />
        <FilterTab
          active={filter === "unread"}
          onClick={() => setFilter("unread")}
          label="Unread"
          count={unreadTotal}
        />
      </div>

      {connectionLabel && (
        <div className="mx-3 mb-2 shrink-0 rounded-lg bg-[var(--surface-hover)] px-3 py-2">
          <p className="flex items-center gap-2 text-[12px] leading-[16px] text-secondary">
            <Spinner size={12} />
            {connectionLabel}
          </p>
        </div>
      )}

      <div className="scrollbar-signal min-h-0 flex-1 overflow-y-auto pb-3">
        {loading && conversations.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner size={22} className="text-tertiary" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState query={query} filter={filter} />
        ) : (
          visible.map((conversation) => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              currentUserId={currentUserId}
              selected={conversation.id === activeId}
              typing={Boolean(typingByConversation[conversation.id])}
              onSelect={() => onSelect(conversation.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium leading-[18px]",
        "transition-colors duration-75",
        active
          ? "bg-ultramarine text-white"
          : "bg-[var(--surface-input)] text-secondary hover:text-primary",
      )}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "tabular-nums",
            active ? "text-white/80" : "text-tertiary",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function EmptyState({ query, filter }: { query: string; filter: Filter }) {
  const message = query
    ? `No results for “${query}”`
    : filter === "unread"
      ? "You're all caught up"
      : "No chats yet";

  return (
    <div className="px-6 py-10 text-center">
      <p className="text-[13px] leading-[18px] text-tertiary">{message}</p>
    </div>
  );
}
