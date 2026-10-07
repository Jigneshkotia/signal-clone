"use client";

/**
 * Conversations, messages, and every live update that touches them.
 *
 * REST responses and WebSocket frames land in the same place deliberately: an
 * optimistic bubble, its server acknowledgement, and a later status change are
 * all one reducer away from each other, so there is no second cache to
 * reconcile.
 */

import { create } from "zustand";

import { ApiError, api } from "@/lib/api";
import { socket, type ConnectionState } from "@/lib/socket";
import { uuid } from "@/lib/utils";
import type {
  Conversation,
  ConversationUpdatePayload,
  Message,
  MessageStatusPayload,
  NewMessagePayload,
  PresencePayload,
  ReactionUpdatePayload,
  TypingPayload,
  WsFrame,
} from "@/types/api";
import { useAuthStore } from "@/store/authStore";
import { useUiStore } from "@/store/uiStore";

/** A typing indicator disappears on its own if no stop frame arrives. */
const TYPING_TTL = 6_000;
const PAGE_SIZE = 50;

interface Pagination {
  hasMore: boolean;
  cursor: string | null;
  loading: boolean;
  loaded: boolean;
}

interface ChatState {
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  pagination: Record<string, Pagination>;
  /** conversation id -> user id -> timestamp the indicator expires at. */
  typing: Record<string, Record<string, number>>;
  activeId: string | null;
  connection: ConnectionState;
  loadingConversations: boolean;

  /* queries */
  conversation: (id: string) => Conversation | undefined;
  messagesFor: (id: string) => Message[];
  typistsFor: (id: string) => string[];
  totalUnread: () => number;

  /* commands */
  loadConversations: () => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  loadOlder: (id: string) => Promise<void>;
  sendMessage: (
    conversationId: string,
    body: string,
    replyToId?: string | null,
  ) => Promise<void>;
  retryMessage: (conversationId: string, clientId: string) => Promise<void>;
  setReaction: (messageId: string, emoji: string | null) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  markRead: (conversationId: string) => void;
  sendTyping: (conversationId: string, isTyping: boolean) => void;
  upsertConversation: (conversation: Conversation) => void;
  removeConversation: (conversationId: string) => void;
  setActive: (id: string | null) => void;
  reset: () => void;

  /* realtime */
  handleFrame: (frame: WsFrame) => void;
  setConnection: (state: ConnectionState) => void;
}

/** Newest activity first, with pinned conversations held at the top. */
function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    const aTime = a.last_message_at ?? a.created_at;
    const bTime = b.last_message_at ?? b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });
}

/** Chronological, de-duplicated by id. */
function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  messages: {},
  pagination: {},
  typing: {},
  activeId: null,
  connection: "idle",
  loadingConversations: false,

  /* ------------------------------------------------------------------ */
  /* Queries                                                            */
  /* ------------------------------------------------------------------ */

  conversation: (id) => get().conversations.find((c) => c.id === id),

  messagesFor: (id) => get().messages[id] ?? [],

  // Entries are pruned by the TTL timer in `handleFrame`, so membership in the
  // map is the whole answer -- no clock reading needed, which also keeps this
  // safe to call during render.
  typistsFor: (id) => Object.keys(get().typing[id] ?? {}),

  totalUnread: () =>
    get().conversations.reduce((sum, c) => sum + c.unread_count, 0),

  /* ------------------------------------------------------------------ */
  /* Loading                                                            */
  /* ------------------------------------------------------------------ */

  loadConversations: async () => {
    set({ loadingConversations: true });
    try {
      const conversations = await api.conversations.list();
      set({
        conversations: sortConversations(conversations),
        loadingConversations: false,
      });
    } catch (error) {
      set({ loadingConversations: false });
      if (error instanceof ApiError && error.status !== 401) {
        useUiStore.getState().toast(error.message, "error");
      }
    }
  },

  openConversation: async (id) => {
    set({ activeId: id });

    const existing = get().pagination[id];
    if (existing?.loaded || existing?.loading) {
      get().markRead(id);
      return;
    }

    set((state) => ({
      pagination: {
        ...state.pagination,
        [id]: { hasMore: false, cursor: null, loading: true, loaded: false },
      },
    }));

    try {
      const page = await api.messages.history(id, { limit: PAGE_SIZE });
      set((state) => ({
        messages: {
          ...state.messages,
          [id]: mergeMessages(state.messages[id] ?? [], page.messages),
        },
        pagination: {
          ...state.pagination,
          [id]: {
            hasMore: page.has_more,
            cursor: page.next_cursor,
            loading: false,
            loaded: true,
          },
        },
      }));
      get().markRead(id);
    } catch (error) {
      set((state) => ({
        pagination: {
          ...state.pagination,
          [id]: { hasMore: false, cursor: null, loading: false, loaded: false },
        },
      }));
      if (error instanceof ApiError && error.status !== 401) {
        useUiStore.getState().toast(error.message, "error");
      }
    }
  },

  loadOlder: async (id) => {
    const page = get().pagination[id];
    if (!page || page.loading || !page.hasMore || !page.cursor) return;

    set((state) => ({
      pagination: { ...state.pagination, [id]: { ...page, loading: true } },
    }));

    try {
      const older = await api.messages.history(id, {
        before: page.cursor,
        limit: PAGE_SIZE,
      });
      set((state) => ({
        messages: {
          ...state.messages,
          [id]: mergeMessages(state.messages[id] ?? [], older.messages),
        },
        pagination: {
          ...state.pagination,
          [id]: {
            hasMore: older.has_more,
            cursor: older.next_cursor,
            loading: false,
            loaded: true,
          },
        },
      }));
    } catch {
      set((state) => ({
        pagination: { ...state.pagination, [id]: { ...page, loading: false } },
      }));
    }
  },

  /* ------------------------------------------------------------------ */
  /* Sending                                                            */
  /* ------------------------------------------------------------------ */

  sendMessage: async (conversationId, body, replyToId) => {
    const trimmed = body.trim();
    if (!trimmed) return;

    const me = useAuthStore.getState().user;
    if (!me) return;

    const clientId = uuid();
    const conversation = get().conversation(conversationId);
    const quoted = replyToId
      ? get()
          .messagesFor(conversationId)
          .find((m) => m.id === replyToId)
      : undefined;

    // Render immediately. The server echo carries the same client_id and
    // replaces this row, so the bubble never flickers or duplicates.
    const optimistic: Message = {
      id: `pending:${clientId}`,
      conversation_id: conversationId,
      sender_id: me.id,
      sender: me,
      body: trimmed,
      type: "text",
      status: "sending",
      client_id: clientId,
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      reply_to: quoted
        ? {
            id: quoted.id,
            body: quoted.body,
            sender_id: quoted.sender_id,
            sender_name: quoted.sender?.display_name ?? "Unknown",
            is_deleted: Boolean(quoted.deleted_at),
          }
        : null,
      reactions: [],
      receipts: [],
      pending: true,
    };

    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...(state.messages[conversationId] ?? []), optimistic],
      },
      conversations: sortConversations(
        state.conversations.map((c) =>
          c.id === conversationId
            ? { ...c, last_message: optimistic, last_message_at: optimistic.created_at }
            : c,
        ),
      ),
    }));

    const payload = {
      conversation_id: conversationId,
      body: trimmed,
      client_id: clientId,
      reply_to_id: replyToId ?? null,
    };

    // Prefer the socket; fall back to REST when it is down so a message is
    // never silently lost.
    if (socket.send("message.send", payload)) return;

    try {
      const saved = await api.messages.send(conversationId, {
        body: trimmed,
        client_id: clientId,
        reply_to_id: replyToId ?? undefined,
      });
      get().handleFrame({
        type: "message.new",
        payload: { message: saved },
      } as WsFrame);
    } catch {
      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: (state.messages[conversationId] ?? []).map((m) =>
            m.client_id === clientId
              ? { ...m, pending: false, failed: true }
              : m,
          ),
        },
      }));
      useUiStore
        .getState()
        .toast("Message not sent. Tap to retry.", "error");
    }
    void conversation;
  },

  retryMessage: async (conversationId, clientId) => {
    const message = get()
      .messagesFor(conversationId)
      .find((m) => m.client_id === clientId);
    if (!message) return;

    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] ?? []).map((m) =>
          m.client_id === clientId ? { ...m, failed: false, pending: true } : m,
        ),
      },
    }));

    // The same client_id makes this idempotent server-side.
    const payload = {
      conversation_id: conversationId,
      body: message.body,
      client_id: clientId,
      reply_to_id: message.reply_to?.id ?? null,
    };
    if (socket.send("message.send", payload)) return;

    try {
      const saved = await api.messages.send(conversationId, {
        body: message.body,
        client_id: clientId,
        reply_to_id: message.reply_to?.id ?? undefined,
      });
      get().handleFrame({
        type: "message.new",
        payload: { message: saved },
      } as WsFrame);
    } catch {
      set((state) => ({
        messages: {
          ...state.messages,
          [conversationId]: (state.messages[conversationId] ?? []).map((m) =>
            m.client_id === clientId ? { ...m, pending: false, failed: true } : m,
          ),
        },
      }));
    }
  },

  /* ------------------------------------------------------------------ */
  /* Reactions and deletion                                             */
  /* ------------------------------------------------------------------ */

  setReaction: async (messageId, emoji) => {
    if (socket.send("reaction.set", { message_id: messageId, emoji })) return;
    try {
      const updated = await api.messages.setReaction(messageId, emoji);
      get().handleFrame({
        type: "reaction.update",
        payload: {
          message_id: updated.id,
          conversation_id: updated.conversation_id,
          reactions: updated.reactions,
        },
      } as WsFrame);
    } catch (error) {
      if (error instanceof ApiError) {
        useUiStore.getState().toast(error.message, "error");
      }
    }
  },

  deleteMessage: async (messageId) => {
    try {
      const deleted = await api.messages.remove(messageId);
      set((state) => ({
        messages: {
          ...state.messages,
          [deleted.conversation_id]: (
            state.messages[deleted.conversation_id] ?? []
          ).map((m) => (m.id === deleted.id ? deleted : m)),
        },
      }));
    } catch (error) {
      if (error instanceof ApiError) {
        useUiStore.getState().toast(error.message, "error");
      }
    }
  },

  /* ------------------------------------------------------------------ */
  /* Receipts and typing                                                */
  /* ------------------------------------------------------------------ */

  markRead: (conversationId) => {
    const messages = get().messagesFor(conversationId);
    const conversation = get().conversation(conversationId);
    if (!conversation) return;

    const newest = [...messages].reverse().find((m) => !m.pending);
    // Clear the badge straight away; the server confirmation only has to agree.
    if (conversation.unread_count > 0) {
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === conversationId ? { ...c, unread_count: 0 } : c,
        ),
      }));
    }
    if (!newest) return;

    const payload = {
      conversation_id: conversationId,
      up_to_message_id: newest.id,
    };
    if (socket.send("receipt.read", payload)) return;
    void api.messages.markRead(conversationId, newest.id).catch(() => {});
  },

  sendTyping: (conversationId, isTyping) => {
    socket.send(isTyping ? "typing.start" : "typing.stop", {
      conversation_id: conversationId,
    });
  },

  /* ------------------------------------------------------------------ */
  /* Conversation list mutations                                        */
  /* ------------------------------------------------------------------ */

  upsertConversation: (conversation) => {
    set((state) => {
      const exists = state.conversations.some((c) => c.id === conversation.id);
      const conversations = exists
        ? state.conversations.map((c) =>
            c.id === conversation.id ? conversation : c,
          )
        : [...state.conversations, conversation];
      return { conversations: sortConversations(conversations) };
    });
  },

  removeConversation: (conversationId) => {
    set((state) => {
      const { [conversationId]: _dropped, ...messages } = state.messages;
      return {
        conversations: state.conversations.filter((c) => c.id !== conversationId),
        messages,
        activeId: state.activeId === conversationId ? null : state.activeId,
      };
    });
  },

  setActive: (id) => set({ activeId: id }),

  reset: () =>
    set({
      conversations: [],
      messages: {},
      pagination: {},
      typing: {},
      activeId: null,
      loadingConversations: false,
    }),

  /* ------------------------------------------------------------------ */
  /* Realtime                                                           */
  /* ------------------------------------------------------------------ */

  setConnection: (connection) => set({ connection }),

  handleFrame: (frame) => {
    const me = useAuthStore.getState().user;

    switch (frame.type) {
      case "message.new": {
        const { message } = frame.payload as unknown as NewMessagePayload;
        const conversationId = message.conversation_id;
        const isMine = message.sender_id === me?.id;
        const isActive = get().activeId === conversationId;

        set((state) => {
          const current = state.messages[conversationId] ?? [];
          // Replace the optimistic row rather than appending beside it.
          const withoutOptimistic = message.client_id
            ? current.filter((m) => m.client_id !== message.client_id)
            : current;

          const alreadyKnown = current.some((m) => m.id === message.id);
          const next = alreadyKnown
            ? current.map((m) => (m.id === message.id ? message : m))
            : mergeMessages(withoutOptimistic, [message]);

          // Only count toward unread if it is someone else's, the thread is not
          // open, and it is not a system notice.
          const bumpUnread =
            !isMine && !isActive && message.type === "text" ? 1 : 0;

          const conversations = state.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  last_message: message,
                  last_message_at: message.created_at,
                  unread_count: c.unread_count + bumpUnread,
                }
              : c,
          );

          // Sender stopped typing by definition.
          const typing = { ...state.typing };
          if (message.sender_id && typing[conversationId]) {
            const { [message.sender_id]: _gone, ...rest } =
              typing[conversationId];
            typing[conversationId] = rest;
          }

          return {
            messages: { ...state.messages, [conversationId]: next },
            conversations: sortConversations(conversations),
            typing,
          };
        });

        // A message arriving in the open thread is read on arrival.
        if (isActive && !isMine) get().markRead(conversationId);

        // A conversation we have never seen (someone started a chat with us).
        if (!get().conversation(conversationId)) {
          void api.conversations
            .get(conversationId)
            .then((conversation) => get().upsertConversation(conversation))
            .catch(() => {});
        }
        break;
      }

      case "message.status": {
        const payload = frame.payload as unknown as MessageStatusPayload;

        if (payload.read_cleared && payload.conversation_id) {
          set((state) => ({
            conversations: state.conversations.map((c) =>
              c.id === payload.conversation_id ? { ...c, unread_count: 0 } : c,
            ),
          }));
          break;
        }

        if (!payload.message_id || !payload.status) break;
        set((state) => {
          const messages = { ...state.messages };
          for (const [conversationId, list] of Object.entries(messages)) {
            const index = list.findIndex((m) => m.id === payload.message_id);
            if (index === -1) continue;
            const copy = [...list];
            copy[index] = { ...copy[index], status: payload.status! };
            messages[conversationId] = copy;
            break;
          }
          return { messages };
        });
        break;
      }

      case "typing": {
        const { conversation_id, user_id, is_typing } =
          frame.payload as unknown as TypingPayload;
        if (user_id === me?.id) break;

        set((state) => {
          const forConversation = { ...(state.typing[conversation_id] ?? {}) };
          if (is_typing) {
            forConversation[user_id] = Date.now() + TYPING_TTL;
          } else {
            delete forConversation[user_id];
          }
          return {
            typing: { ...state.typing, [conversation_id]: forConversation },
          };
        });

        // Expire the indicator even if the stop frame never arrives.
        if (is_typing) {
          setTimeout(() => {
            set((state) => {
              const forConversation = state.typing[conversation_id];
              if (!forConversation) return state;
              const expiry = forConversation[user_id];
              if (!expiry || expiry > Date.now()) return state;
              const { [user_id]: _expired, ...rest } = forConversation;
              return {
                typing: { ...state.typing, [conversation_id]: rest },
              };
            });
          }, TYPING_TTL + 100);
        }
        break;
      }

      case "presence": {
        const { user_id, is_online, last_seen_at } =
          frame.payload as unknown as PresencePayload;

        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            const touchesUser =
              conversation.other_user?.id === user_id ||
              conversation.members.some((m) => m.user.id === user_id);
            if (!touchesUser) return conversation;

            return {
              ...conversation,
              other_user:
                conversation.other_user?.id === user_id
                  ? {
                      ...conversation.other_user,
                      is_online,
                      last_seen_at: last_seen_at,
                    }
                  : conversation.other_user,
              members: conversation.members.map((member) =>
                member.user.id === user_id
                  ? {
                      ...member,
                      user: {
                        ...member.user,
                        is_online,
                        last_seen_at: last_seen_at,
                      },
                    }
                  : member,
              ),
            };
          }),
        }));
        break;
      }

      case "reaction.update": {
        const { message_id, conversation_id, reactions } =
          frame.payload as unknown as ReactionUpdatePayload;

        set((state) => ({
          messages: {
            ...state.messages,
            [conversation_id]: (state.messages[conversation_id] ?? []).map((m) =>
              m.id === message_id ? { ...m, reactions } : m,
            ),
          },
        }));
        break;
      }

      case "conversation.update": {
        const payload = frame.payload as unknown as ConversationUpdatePayload;
        if (payload.removed && payload.conversation_id) {
          get().removeConversation(payload.conversation_id);
          useUiStore
            .getState()
            .toast("You were removed from a group", "neutral");
          break;
        }
        if (payload.conversation) {
          get().upsertConversation(payload.conversation);
        }
        break;
      }

      case "error": {
        const { message } = frame.payload as unknown as { message: string };
        useUiStore.getState().toast(message, "error");
        break;
      }

      default:
        break;
    }
  },
}));
