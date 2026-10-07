"use client";

/**
 * Session state.
 *
 * Owns the token, the signed-in user, and the socket's lifecycle -- connecting
 * on sign-in and tearing down on sign-out, so no other component has to think
 * about it.
 */

import { create } from "zustand";

import {
  ApiError,
  api,
  getToken,
  setToken,
  setUnauthorizedHandler,
} from "@/lib/api";
import { socket } from "@/lib/socket";
import type { UserMe } from "@/types/api";

interface AuthState {
  user: UserMe | null;
  /** False until the stored token has been checked, so guards do not flash. */
  ready: boolean;
  busy: boolean;
  error: string | null;

  hydrate: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<void>;
  register: (payload: {
    phone_number?: string;
    username?: string;
    display_name: string;
    password: string;
    about?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (payload: {
    display_name?: string;
    about?: string | null;
    avatar_color?: string;
  }) => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  ready: false,
  busy: false,
  error: null,

  /** Restore a session from the stored token on first load. */
  hydrate: async () => {
    const token = getToken();
    if (!token) {
      set({ ready: true, user: null });
      return;
    }

    try {
      const user = await api.auth.me();
      set({ user, ready: true, error: null });
      socket.connect(token);
    } catch {
      // Token expired or the user no longer exists.
      setToken(null);
      set({ user: null, ready: true });
    }
  },

  login: async (identifier, password) => {
    set({ busy: true, error: null });
    try {
      const result = await api.auth.login(identifier, password);
      setToken(result.access_token);
      set({ user: result.user, busy: false, ready: true });
      socket.connect(result.access_token);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Could not sign in";
      set({ busy: false, error: message });
      throw error;
    }
  },

  register: async (payload) => {
    set({ busy: true, error: null });
    try {
      const result = await api.auth.register(payload);
      setToken(result.access_token);
      set({ user: result.user, busy: false, ready: true });
      socket.connect(result.access_token);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Could not create account";
      set({ busy: false, error: message });
      throw error;
    }
  },

  logout: async () => {
    // Close the socket before clearing the token so the server sees a clean
    // close and broadcasts the offline presence change.
    socket.disconnect();
    try {
      await api.auth.logout();
    } catch {
      /* a failed logout call should never block signing out locally */
    }
    setToken(null);
    set({ user: null, error: null });
  },

  updateProfile: async (payload) => {
    const user = await api.users.updateMe(payload);
    set({ user });
  },

  clearError: () => set({ error: null }),
}));

/**
 * A 401 from any request means the session is gone; drop it once, centrally,
 * rather than handling it at every call site.
 */
setUnauthorizedHandler(() => {
  setToken(null);
  socket.disconnect();
  useAuthStore.setState({ user: null, ready: true });
});
