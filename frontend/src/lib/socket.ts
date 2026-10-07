/**
 * A reconnecting WebSocket client.
 *
 * Responsibilities deliberately kept narrow: connect, reconnect with backoff,
 * emit typed frames, and report connection state. Deciding what a frame *means*
 * belongs to the stores, which subscribe through `onFrame`.
 */

import type { ClientEventType, ServerEventType, WsFrame } from "@/types/api";

const RAW_WS =
  process.env.NEXT_PUBLIC_WS_URL ??
  process.env.NEXT_PUBLIC_API_URL?.replace(/^http/, "ws") ??
  "ws://127.0.0.1:8000";

const WS_BASE = RAW_WS.replace(/\/$/, "");

export type ConnectionState = "idle" | "connecting" | "open" | "reconnecting";

type FrameHandler = (frame: WsFrame) => void;
type StateHandler = (state: ConnectionState) => void;

const INITIAL_BACKOFF = 1_000;
const MAX_BACKOFF = 30_000;
/** Keeps intermediaries from closing an idle connection. */
const HEARTBEAT_INTERVAL = 25_000;

class SocketClient {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private backoff = INITIAL_BACKOFF;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private state: ConnectionState = "idle";
  /** True once `disconnect()` is called, so a deliberate close never retries. */
  private closedByUs = false;

  private frameHandlers = new Set<FrameHandler>();
  private stateHandlers = new Set<StateHandler>();

  /* ---------------------------------------------------------------- */
  /* Subscription                                                     */
  /* ---------------------------------------------------------------- */

  onFrame(handler: FrameHandler): () => void {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  }

  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    // Report the current state immediately so a late subscriber is not blind.
    handler(this.state);
    return () => this.stateHandlers.delete(handler);
  }

  getState(): ConnectionState {
    return this.state;
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  connect(token: string): void {
    if (typeof window === "undefined") return;

    // Already connected with this token: nothing to do.
    if (
      this.token === token &&
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.token = token;
    this.closedByUs = false;
    this.openSocket();
  }

  disconnect(): void {
    this.closedByUs = true;
    this.token = null;
    this.clearTimers();

    if (this.socket) {
      // Drop handlers first so our own close does not trigger a reconnect.
      this.socket.onclose = null;
      this.socket.onerror = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close(1000, "Client signed out");
      }
      this.socket = null;
    }
    this.setState("idle");
  }

  private openSocket(): void {
    if (!this.token) return;

    this.setState(this.backoff === INITIAL_BACKOFF ? "connecting" : "reconnecting");

    const socket = new WebSocket(
      `${WS_BASE}/ws?token=${encodeURIComponent(this.token)}`,
    );
    this.socket = socket;

    socket.onopen = () => {
      this.backoff = INITIAL_BACKOFF;
      this.setState("open");
      this.startHeartbeat();
    };

    socket.onmessage = (event) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(event.data as string) as WsFrame;
      } catch {
        return;
      }
      if (frame.type === "pong") return;
      this.frameHandlers.forEach((handler) => handler(frame));
    };

    socket.onerror = () => {
      // `onclose` always follows, which is where the retry lives.
    };

    socket.onclose = (event) => {
      this.stopHeartbeat();
      this.socket = null;
      if (this.closedByUs) return;

      // 1008 is our policy-violation close for a bad or expired token.
      // Retrying would loop forever, so surface it as idle and let the auth
      // layer deal with it.
      if (event.code === 1008) {
        this.setState("idle");
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    this.clearReconnectTimer();

    // Full jitter, so many tabs waking at once do not stampede the server.
    const delay = Math.random() * this.backoff;
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
  }

  /* ---------------------------------------------------------------- */
  /* Sending                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Send a frame. Returns false when the socket is not open, which is the
   * caller's cue to fall back to REST rather than silently dropping the message.
   */
  send(type: ClientEventType, payload: Record<string, unknown> = {}): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify({ type, payload }));
      return true;
    } catch {
      return false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                        */
  /* ---------------------------------------------------------------- */

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateHandlers.forEach((handler) => handler(state));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send("ping");
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private clearTimers(): void {
    this.clearReconnectTimer();
    this.stopHeartbeat();
  }
}

/** One socket per tab. */
export const socket = new SocketClient();

export type { ServerEventType };
