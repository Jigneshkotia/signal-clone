"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { DateDivider } from "@/components/chat/DateDivider";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { SystemMessage } from "@/components/chat/SystemMessage";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { LockIcon } from "@/components/icons";
import { Spinner } from "@/components/ui/Spinner";
import { isSameDay, shouldGroup } from "@/lib/format";
import type { Conversation, Message, UserPublic } from "@/types/api";

interface MessageTimelineProps {
  conversation: Conversation;
  messages: Message[];
  currentUserId: string;
  typists: UserPublic[];
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onReply: (message: Message) => void;
  onReact: (messageId: string, emoji: string) => void;
  onDelete: (messageId: string) => void;
  onRetry: (clientId: string) => void;
}

/** Treat the view as "at the bottom" within this many pixels. */
const STICK_THRESHOLD = 120;
/** Start fetching older history this far from the top. */
const LOAD_MORE_THRESHOLD = 240;

export function MessageTimeline({
  conversation,
  messages,
  currentUserId,
  typists,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onReply,
  onReact,
  onDelete,
  onRetry,
}: MessageTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  /** Whether the user is pinned to the bottom; drives auto-scroll on new mail. */
  const stuckToBottom = useRef(true);
  /** Scroll height captured before prepending older messages. */
  const restoreRef = useRef<number | null>(null);
  const lastMessageId = useRef<string | null>(null);
  const conversationId = useRef(conversation.id);

  const isAtBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return true;
    return (
      element.scrollHeight - element.scrollTop - element.clientHeight <
      STICK_THRESHOLD
    );
  }, []);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;

    stuckToBottom.current = isAtBottom();

    if (element.scrollTop < LOAD_MORE_THRESHOLD && hasMore && !loadingOlder) {
      // Remember the height so the viewport can be held still once the older
      // page is prepended.
      restoreRef.current = element.scrollHeight;
      onLoadOlder();
    }
  }, [hasMore, loadingOlder, onLoadOlder, isAtBottom]);

  // Jump to the bottom when the conversation changes.
  useLayoutEffect(() => {
    if (conversationId.current !== conversation.id) {
      conversationId.current = conversation.id;
      stuckToBottom.current = true;
      restoreRef.current = null;
      lastMessageId.current = null;
    }
  }, [conversation.id]);

  // Keep the viewport anchored after older messages are prepended.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || restoreRef.current === null) return;

    const delta = element.scrollHeight - restoreRef.current;
    if (delta > 0) element.scrollTop += delta;
    restoreRef.current = null;
  }, [messages]);

  // Follow new messages, but only when the user has not scrolled away.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || messages.length === 0) return;

    const newest = messages[messages.length - 1];
    const isNew = newest.id !== lastMessageId.current;
    const firstRender = lastMessageId.current === null;
    lastMessageId.current = newest.id;

    if (!isNew) return;

    const mine = newest.sender_id === currentUserId;
    // Always follow your own message; follow others only when already at rest
    // at the bottom, so reading history is never yanked away.
    if (firstRender || mine || stuckToBottom.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, currentUserId]);

  // Typing bubbles change the height; keep up if we are at the bottom.
  useEffect(() => {
    if (stuckToBottom.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [typists.length]);

  const isGroup = conversation.type === "group";

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="scrollbar-signal flex-1 overflow-y-auto overscroll-contain"
    >
      <div className="flex min-h-full flex-col justify-end py-2">
        {loadingOlder && (
          <div className="flex justify-center py-3">
            <Spinner size={18} className="text-tertiary" />
          </div>
        )}

        {!hasMore && !loadingOlder && (
          <ConversationIntro conversation={conversation} />
        )}

        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const next = messages[index + 1];

          const needsDivider =
            !previous || !isSameDay(previous.created_at, message.created_at);

          if (message.type === "system") {
            return (
              <div key={message.id}>
                {needsDivider && <DateDivider iso={message.created_at} />}
                <SystemMessage>{message.body}</SystemMessage>
              </div>
            );
          }

          const groupedAbove = !needsDivider && shouldGroup(previous, message);
          const groupedBelow = next ? shouldGroup(message, next) : false;

          return (
            <div key={message.id}>
              {needsDivider && <DateDivider iso={message.created_at} />}
              <MessageBubble
                message={message}
                currentUserId={currentUserId}
                isGroup={isGroup}
                groupedAbove={groupedAbove}
                groupedBelow={groupedBelow}
                onReply={onReply}
                onReact={onReact}
                onDelete={onDelete}
                onRetry={onRetry}
              />
            </div>
          );
        })}

        <TypingIndicator users={typists} isGroup={isGroup} />
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/**
 * The head of a thread. Signal opens every conversation with a reassurance that
 * it is encrypted -- here it doubles as an honest note that this clone only
 * simulates that.
 */
function ConversationIntro({ conversation }: { conversation: Conversation }) {
  return (
    <div className="flex flex-col items-center gap-2 px-10 pb-4 pt-8">
      <div className="flex items-center gap-1.5 rounded-full bg-[var(--surface-hover)] px-3 py-1.5">
        <LockIcon size={13} className="text-tertiary" />
        <p className="text-center text-[12px] leading-[16px] text-secondary">
          Messages are end-to-end encrypted
          <span className="text-tertiary"> (simulated)</span>
        </p>
      </div>
      <p className="max-w-[320px] text-center text-[12px] leading-[16px] text-tertiary">
        {conversation.type === "group"
          ? `This is the beginning of ${conversation.title}.`
          : `This is the beginning of your conversation with ${conversation.title}.`}
      </p>
    </div>
  );
}
