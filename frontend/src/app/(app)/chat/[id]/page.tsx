"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Composer } from "@/components/chat/Composer";
import { ConversationHeader } from "@/components/chat/ConversationHeader";
import { MessageTimeline } from "@/components/chat/MessageTimeline";
import { Spinner } from "@/components/ui/Spinner";
import { useAuthStore } from "@/store/authStore";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";
import type { Message } from "@/types/api";

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const conversationId = params.id;

  const openConversation = useChatStore((state) => state.openConversation);
  const markRead = useChatStore((state) => state.markRead);
  const setMobilePane = useUiStore((state) => state.setMobilePane);

  useEffect(() => {
    void openConversation(conversationId);
    // Showing a conversation means the chat pane is the active one on mobile,
    // which matters when this route is opened directly or refreshed.
    setMobilePane("chat");
  }, [conversationId, openConversation, setMobilePane]);

  // Coming back to the tab with the thread open means you have read it.
  useEffect(() => {
    const onFocus = () => markRead(conversationId);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [conversationId, markRead]);

  /*
   * Keyed by conversation id so switching threads remounts the view.
   *
   * That is what clears the draft and any in-progress reply: React throws the
   * old state away rather than us syncing it back to null in an effect, which
   * would be both more code and one render late.
   */
  return <ConversationView key={conversationId} conversationId={conversationId} />;
}

function ConversationView({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const openModal = useUiStore((state) => state.openModal);
  const setMobilePane = useUiStore((state) => state.setMobilePane);

  const conversation = useChatStore((state) =>
    state.conversations.find((c) => c.id === conversationId),
  );
  const messages = useChatStore((state) => state.messages[conversationId]);
  const pagination = useChatStore((state) => state.pagination[conversationId]);
  const typingMap = useChatStore((state) => state.typing[conversationId]);

  const loadOlder = useChatStore((state) => state.loadOlder);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const retryMessage = useChatStore((state) => state.retryMessage);
  const setReaction = useChatStore((state) => state.setReaction);
  const deleteMessage = useChatStore((state) => state.deleteMessage);
  const sendTyping = useChatStore((state) => state.sendTyping);

  const [replyTo, setReplyTo] = useState<Message | null>(null);

  /**
   * Everyone currently typing here, excluding yourself. The store's TTL timer
   * removes stale entries, so no clock read is needed during render.
   */
  const typists = useMemo(() => {
    if (!typingMap || !conversation) return [];
    const activeIds = new Set(Object.keys(typingMap));

    return conversation.members
      .filter((member) => activeIds.has(member.user.id))
      .map((member) => member.user);
  }, [typingMap, conversation]);

  const handleSend = useCallback(
    (body: string, replyToId: string | null) => {
      void sendMessage(conversationId, body, replyToId);
      setReplyTo(null);
    },
    [conversationId, sendMessage],
  );

  const handleUnsupported = useCallback(
    (feature: string) => openModal("coming-soon", feature),
    [openModal],
  );

  if (!user) return null;

  if (!conversation) {
    return (
      <div className="flex h-full items-center justify-center bg-app">
        <Spinner size={24} className="text-tertiary" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-app">
      <ConversationHeader
        conversation={conversation}
        typistNames={typists.map((t) => t.display_name.split(" ")[0])}
        onOpenDetails={() => openModal("group-details", conversationId)}
        onBack={() => {
          setMobilePane("list");
          router.push("/chat");
        }}
        onUnsupported={handleUnsupported}
      />

      <MessageTimeline
        conversation={conversation}
        messages={messages ?? []}
        currentUserId={user.id}
        typists={typists}
        hasMore={pagination?.hasMore ?? false}
        loadingOlder={pagination?.loading ?? false}
        onLoadOlder={() => loadOlder(conversationId)}
        onReply={setReplyTo}
        onReact={(messageId, emoji) => void setReaction(messageId, emoji)}
        onDelete={(messageId) => void deleteMessage(messageId)}
        onRetry={(clientId) => void retryMessage(conversationId, clientId)}
      />

      <Composer
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onSend={handleSend}
        onTyping={(isTyping) => sendTyping(conversationId, isTyping)}
        onUnsupported={handleUnsupported}
      />
    </div>
  );
}
