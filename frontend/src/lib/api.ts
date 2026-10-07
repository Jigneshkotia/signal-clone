/**
 * Typed REST client.
 *
 * The access token lives in `localStorage` rather than an httpOnly cookie. That
 * is a deliberate trade for this deployment shape: the frontend is on
 * `*.vercel.app` and the API on `*.onrender.com`, so a cookie would need
 * `SameSite=None; Secure` and still would not reach the WebSocket handshake,
 * which cannot send headers. The README spells out the trade-off.
 */

import type {
  AuthResponse,
  Contact,
  Conversation,
  MemberRole,
  Message,
  MessagePage,
  OtpChallenge,
  SafetyNumber,
  UserMe,
  UserPublic,
} from "@/types/api";

const RAW_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

export const API_BASE = `${RAW_BASE}/api`;
const TOKEN_KEY = "signal-clone.token";

/* ------------------------------------------------------------------ */
/* Token storage                                                       */
/* ------------------------------------------------------------------ */

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // Private browsing or blocked site data.
    return null;
  }
}

export function setToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore -- the session simply will not persist */
  }
}

/* ------------------------------------------------------------------ */
/* Core request helper                                                 */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Set by the auth store so a 401 anywhere can tear the session down once. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

async function request<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = options;

  const finalHeaders = new Headers(headers);
  if (!finalHeaders.has("Content-Type") && rest.body) {
    finalHeaders.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = getToken();
    if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: finalHeaders,
    });
  } catch {
    // Render's free tier sleeps after inactivity, so the first request after a
    // quiet spell can take ~50s or fail outright. Say so rather than "failed
    // to fetch".
    throw new ApiError(
      0,
      "Cannot reach the server. If this is the hosted demo it may be waking up -- try again in a moment.",
    );
  }

  if (response.status === 401 && auth) {
    onUnauthorized?.();
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }

  if (!response.ok) {
    throw new ApiError(response.status, await extractError(response));
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Pull a readable message out of a FastAPI error body. */
async function extractError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const detail = body?.detail;

    if (typeof detail === "string") return detail;
    // Pydantic validation errors arrive as a list of {loc, msg, type}.
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0];
      const field = Array.isArray(first?.loc)
        ? first.loc[first.loc.length - 1]
        : undefined;
      const msg = first?.msg ?? "Invalid request";
      return field ? `${String(field)}: ${msg}` : String(msg);
    }
  } catch {
    /* fall through to the generic message */
  }
  return `Request failed (${response.status})`;
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export const api = {
  auth: {
    requestOtp: (payload: { phone_number?: string; username?: string }) =>
      request<OtpChallenge>("/auth/request-otp", {
        method: "POST",
        auth: false,
        ...json(payload),
      }),

    verifyOtp: (payload: {
      phone_number?: string;
      username?: string;
      code: string;
    }) =>
      request<{ verified: boolean }>("/auth/verify-otp", {
        method: "POST",
        auth: false,
        ...json(payload),
      }),

    register: (payload: {
      phone_number?: string;
      username?: string;
      display_name: string;
      password: string;
      about?: string;
      avatar_url?: string;
    }) =>
      request<AuthResponse>("/auth/register", {
        method: "POST",
        auth: false,
        ...json(payload),
      }),

    login: (identifier: string, password: string) =>
      request<AuthResponse>("/auth/login", {
        method: "POST",
        auth: false,
        ...json({ identifier, password }),
      }),

    logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

    me: () => request<UserMe>("/auth/me"),
  },

  users: {
    updateMe: (payload: {
      display_name?: string;
      about?: string | null;
      avatar_url?: string | null;
      avatar_color?: string;
    }) => request<UserMe>("/users/me", { method: "PATCH", ...json(payload) }),

    search: (query: string) =>
      request<UserPublic[]>(`/users/search?q=${encodeURIComponent(query)}`),

    get: (userId: string) => request<UserPublic>(`/users/${userId}`),

    colors: () => request<Record<string, string>>("/users/colors"),
  },

  contacts: {
    list: () => request<Contact[]>("/contacts"),

    add: (payload: {
      phone_number?: string;
      username?: string;
      nickname?: string;
    }) => request<Contact>("/contacts", { method: "POST", ...json(payload) }),

    remove: (contactId: string) =>
      request<void>(`/contacts/${contactId}`, { method: "DELETE" }),
  },

  conversations: {
    list: () => request<Conversation[]>("/conversations"),

    get: (id: string) => request<Conversation>(`/conversations/${id}`),

    createDirect: (userId: string) =>
      request<Conversation>("/conversations/direct", {
        method: "POST",
        ...json({ user_id: userId }),
      }),

    createGroup: (payload: {
      name: string;
      member_ids: string[];
      description?: string;
    }) =>
      request<Conversation>("/conversations/group", {
        method: "POST",
        ...json(payload),
      }),

    update: (
      id: string,
      payload: {
        name?: string;
        description?: string | null;
        disappear_seconds?: number;
      },
    ) =>
      request<Conversation>(`/conversations/${id}`, {
        method: "PATCH",
        ...json(payload),
      }),

    addMembers: (id: string, userIds: string[]) =>
      request<Conversation>(`/conversations/${id}/members`, {
        method: "POST",
        ...json({ user_ids: userIds }),
      }),

    removeMember: (id: string, userId: string) =>
      request<Conversation>(`/conversations/${id}/members/${userId}`, {
        method: "DELETE",
      }),

    setRole: (id: string, userId: string, role: MemberRole) =>
      request<Conversation>(
        `/conversations/${id}/members/${userId}/role?role=${role}`,
        { method: "PATCH" },
      ),

    setState: (
      id: string,
      payload: {
        is_pinned?: boolean;
        is_archived?: boolean;
        muted_until?: string | null;
      },
    ) =>
      request<Conversation>(`/conversations/${id}/state`, {
        method: "PATCH",
        ...json(payload),
      }),

    safetyNumber: (id: string) =>
      request<SafetyNumber>(`/conversations/${id}/safety-number`),
  },

  messages: {
    history: (conversationId: string, options: { before?: string; limit?: number } = {}) => {
      const params = new URLSearchParams();
      if (options.before) params.set("before", options.before);
      params.set("limit", String(options.limit ?? 50));
      return request<MessagePage>(
        `/conversations/${conversationId}/messages?${params}`,
      );
    },

    send: (
      conversationId: string,
      payload: { body: string; client_id?: string; reply_to_id?: string },
    ) =>
      request<Message>(`/conversations/${conversationId}/messages`, {
        method: "POST",
        ...json(payload),
      }),

    markRead: (conversationId: string, upToMessageId?: string) =>
      request<Message[]>(`/conversations/${conversationId}/read`, {
        method: "POST",
        ...json({ up_to_message_id: upToMessageId ?? null }),
      }),

    setReaction: (messageId: string, emoji: string | null) =>
      request<Message>(`/messages/${messageId}/reaction`, {
        method: "PUT",
        ...json({ emoji }),
      }),

    remove: (messageId: string) =>
      request<Message>(`/messages/${messageId}`, { method: "DELETE" }),
  },
};
