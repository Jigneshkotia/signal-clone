/**
 * Wire types.
 *
 * These mirror the Pydantic schemas in `backend/app/schemas/`. When a schema
 * changes on the backend, change it here too -- there is no codegen step, which
 * is a deliberate simplification for a project this size.
 */

export type ConversationType = "direct" | "group";
export type MemberRole = "admin" | "member";
export type MessageType = "text" | "system";
export type MessageStatus = "sending" | "sent" | "delivered" | "read";

/** One of Signal's twelve conversation colours. See `lib/colors.ts`. */
export type AvatarColor =
  | "crimson"
  | "vermilion"
  | "burlap"
  | "forest"
  | "wintergreen"
  | "teal"
  | "blue"
  | "indigo"
  | "violet"
  | "plum"
  | "taupe"
  | "steel"
  | "ultramarine";

export interface UserPublic {
  id: string;
  display_name: string;
  username: string | null;
  phone_number: string | null;
  about: string | null;
  avatar_url: string | null;
  avatar_color: AvatarColor;
  is_online: boolean;
  last_seen_at: string | null;
}

export interface UserMe extends UserPublic {
  identity_key: string;
  created_at: string;
}

export interface Receipt {
  user_id: string;
  delivered_at: string | null;
  read_at: string | null;
}

export interface Reaction {
  emoji: string;
  user_id: string;
  created_at: string;
}

export interface QuotedMessage {
  id: string;
  body: string;
  sender_id: string | null;
  sender_name: string;
  is_deleted: boolean;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  sender: UserPublic | null;
  body: string;
  type: MessageType;
  status: MessageStatus;
  client_id: string | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply_to: QuotedMessage | null;
  reactions: Reaction[];
  receipts: Receipt[];
  /**
   * Client-only. Set on a bubble that has been rendered optimistically but not
   * yet acknowledged, so the timeline can show a spinner and a failed send can
   * be retried.
   */
  pending?: boolean;
  failed?: boolean;
}

export interface Member {
  user: UserPublic;
  role: MemberRole;
  joined_at: string;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string;
  description: string | null;
  avatar_url: string | null;
  avatar_color: AvatarColor;
  disappear_seconds: number;
  members: Member[];
  other_user: UserPublic | null;
  last_message: Message | null;
  last_message_at: string | null;
  unread_count: number;
  is_pinned: boolean;
  is_archived: boolean;
  is_muted: boolean;
  my_role: MemberRole;
  created_at: string;
}

export interface MessagePage {
  messages: Message[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface Contact {
  id: string;
  nickname: string | null;
  created_at: string;
  user: UserPublic;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: UserMe;
}

export interface OtpChallenge {
  sent_to: string;
  demo_code: string;
  message: string;
}

export interface SafetyNumber {
  conversation_id: string;
  safety_number: string;
  groups: string[];
  verified: boolean;
}

/* ------------------------------------------------------------------ */
/* WebSocket frames -- mirrors `backend/app/realtime/events.py`       */
/* ------------------------------------------------------------------ */

export type ClientEventType =
  | "message.send"
  | "typing.start"
  | "typing.stop"
  | "receipt.read"
  | "reaction.set"
  | "ping";

export type ServerEventType =
  | "ready"
  | "message.new"
  | "message.status"
  | "typing"
  | "presence"
  | "reaction.update"
  | "conversation.update"
  | "error"
  | "pong";

export interface WsFrame<T = Record<string, unknown>> {
  type: ServerEventType;
  payload: T;
}

export interface ReadyPayload {
  user_id: string;
}

export interface NewMessagePayload {
  message: Message;
}

export interface MessageStatusPayload {
  message_id?: string;
  conversation_id?: string;
  status?: MessageStatus;
  /** Sent to a reader's other tabs so they can clear the unread badge. */
  read_cleared?: boolean;
}

export interface TypingPayload {
  conversation_id: string;
  user_id: string;
  is_typing: boolean;
}

export interface PresencePayload {
  user_id: string;
  is_online: boolean;
  last_seen_at: string | null;
}

export interface ReactionUpdatePayload {
  message_id: string;
  conversation_id: string;
  reactions: Reaction[];
}

export interface ConversationUpdatePayload {
  conversation?: Conversation;
  conversation_id?: string;
  removed?: boolean;
}

export interface ErrorPayload {
  code: string;
  message: string;
}
