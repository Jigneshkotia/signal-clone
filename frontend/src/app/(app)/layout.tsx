"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";

import { LeftPane } from "@/components/conversation-list/LeftPane";
import { NavRail } from "@/components/layout/NavRail";
import { ModalHost } from "@/components/modals/ModalHost";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";

/**
 * The persistent shell: nav rail, chat list, and whichever conversation is
 * routed into the right-hand pane.
 *
 * Living in a route-group layout means the list and its scroll position
 * survive navigation between conversations.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  const ready = useAuthStore((state) => state.ready);
  const user = useAuthStore((state) => state.user);

  const conversations = useChatStore((state) => state.conversations);
  const activeId = useChatStore((state) => state.activeId);
  const typing = useChatStore((state) => state.typing);
  const connection = useChatStore((state) => state.connection);
  const loading = useChatStore((state) => state.loadingConversations);
  const loadConversations = useChatStore((state) => state.loadConversations);
  const reset = useChatStore((state) => state.reset);

  const mobilePane = useUiStore((state) => state.mobilePane);
  const setMobilePane = useUiStore((state) => state.setMobilePane);
  const openModal = useUiStore((state) => state.openModal);

  // Send unauthenticated visitors to onboarding.
  useEffect(() => {
    if (ready && !user) {
      reset();
      router.replace("/onboarding");
    }
  }, [ready, user, router, reset]);

  useEffect(() => {
    if (user) void loadConversations();
  }, [user, loadConversations]);

  /**
   * conversation id -> is anyone typing, for the list's preview line.
   *
   * Expired entries are removed by the store's TTL timer, so presence in the
   * map is sufficient -- deliberately no clock read here, since reading the
   * time during render is not prerender-safe.
   */
  const typingByConversation = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const [conversationId, typists] of Object.entries(typing)) {
      result[conversationId] = Object.keys(typists).length > 0;
    }
    return result;
  }, [typing]);

  const unreadTotal = conversations.reduce((sum, c) => sum + c.unread_count, 0);

  const connectionLabel =
    connection === "reconnecting"
      ? "Reconnecting…"
      : connection === "connecting"
        ? "Connecting…"
        : null;

  if (!ready || !user) {
    return (
      <div className="flex h-full items-center justify-center bg-app">
        <Spinner size={26} className="text-ultramarine" />
      </div>
    );
  }

  const handleUnsupported = (feature: string) =>
    openModal("coming-soon", feature);

  return (
    <div className="flex h-full w-full overflow-hidden bg-app">
      <NavRail
        user={user}
        unreadTotal={unreadTotal}
        onOpenSettings={() => openModal("settings")}
        onUnsupported={handleUnsupported}
      />

      {/*
        Two panes on desktop. Below `md` only one is mounted at a time, which
        keeps the mobile layout a true single-pane view rather than a squeezed
        desktop one.
      */}
      <aside
        className={cn(
          "h-full w-full shrink-0 border-r border-[var(--border-subtle)] md:w-[320px]",
          mobilePane === "chat" && "hidden md:block",
        )}
      >
        <LeftPane
          conversations={conversations}
          currentUserId={user.id}
          activeId={activeId}
          typingByConversation={typingByConversation}
          loading={loading}
          connectionLabel={connectionLabel}
          onSelect={(id) => {
            setMobilePane("chat");
            router.push(`/chat/${id}`);
          }}
          onNewChat={() => openModal("new-chat")}
        />
      </aside>

      <main
        className={cn(
          "h-full min-w-0 flex-1",
          mobilePane === "list" && "hidden md:block",
        )}
      >
        {children}
      </main>

      <ModalHost />
    </div>
  );
}
