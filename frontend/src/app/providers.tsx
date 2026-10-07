"use client";

import { useEffect, type ReactNode } from "react";

import { Toaster } from "@/components/ui/Toaster";
import { socket } from "@/lib/socket";
import { useAuthStore } from "@/store/authStore";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";

/**
 * Wires the global singletons to React exactly once.
 *
 * The socket is a module-level object, so it is subscribed here rather than in
 * a component that might mount twice -- every frame it emits is routed into the
 * chat store from this one place.
 */
export function Providers({ children }: { children: ReactNode }) {
  const hydrate = useAuthStore((state) => state.hydrate);
  const initTheme = useUiStore((state) => state.initTheme);

  useEffect(() => {
    initTheme();
    void hydrate();
  }, [hydrate, initTheme]);

  useEffect(() => {
    const offFrame = socket.onFrame((frame) => {
      useChatStore.getState().handleFrame(frame);
    });

    const offState = socket.onStateChange((state) => {
      const store = useChatStore.getState();
      const previous = store.connection;
      store.setConnection(state);

      // Frames that arrived while the socket was down are gone, so refetch the
      // list on recovery to close any gap.
      if (previous === "reconnecting" && state === "open") {
        void store.loadConversations();
        const activeId = store.activeId;
        if (activeId) {
          useChatStore.setState((current) => ({
            pagination: {
              ...current.pagination,
              [activeId]: {
                ...(current.pagination[activeId] ?? {
                  hasMore: false,
                  cursor: null,
                  loading: false,
                }),
                loaded: false,
              },
            },
          }));
          void store.openConversation(activeId);
        }
      }
    });

    return () => {
      offFrame();
      offState();
    };
  }, []);

  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
