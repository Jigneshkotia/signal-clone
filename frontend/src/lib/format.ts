/**
 * Timestamp formatting, following Signal's own rules.
 *
 * Signal uses different formats in different places, and getting them wrong is
 * one of the most obvious tells that a clone is not the real thing:
 *
 *   chat list      today -> "10:42 AM", yesterday -> "Yesterday",
 *                  this week -> "Tue", older -> "Oct 3" (+ year if not this year)
 *   message bubble always a clock time, "10:42 AM"
 *   date divider   "Today", "Yesterday", "Mon, Oct 5"
 *
 * All backend timestamps are ISO strings with a UTC offset (see the
 * `UtcDateTime` column type), so `new Date()` converts to local time correctly.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(date: Date): number {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

/** Whole calendar days between two dates, ignoring clock time. */
function calendarDaysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / DAY);
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const weekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const monthDayFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});
const monthDayYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const dividerFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const dividerYearFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const fullFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "10:42 AM" -- used inside message bubbles. */
export function formatTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

/** The chat-list timestamp. */
export function formatListTimestamp(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  const days = calendarDaysAgo(date, now);

  if (days <= 0) return timeFormatter.format(date);
  if (days === 1) return "Yesterday";
  if (days < 7) return weekdayFormatter.format(date);
  if (date.getFullYear() === now.getFullYear()) {
    return monthDayFormatter.format(date);
  }
  return monthDayYearFormatter.format(date);
}

/** The sticky divider between days in the timeline. */
export function formatDateDivider(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = calendarDaysAgo(date, now);

  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (date.getFullYear() === now.getFullYear()) {
    return dividerFormatter.format(date);
  }
  return dividerYearFormatter.format(date);
}

/** Full date and time, for tooltips and the message-details panel. */
export function formatFull(iso: string): string {
  return fullFormatter.format(new Date(iso));
}

/**
 * The subtitle under a conversation title: "Active now", "Active 5m ago".
 * Signal shows nothing at all once someone has been away long enough that a
 * precise figure stops being useful.
 */
export function formatPresence(
  isOnline: boolean,
  lastSeenAt: string | null,
  now = new Date(),
): string | null {
  if (isOnline) return "Active now";
  if (!lastSeenAt) return null;

  const elapsed = now.getTime() - new Date(lastSeenAt).getTime();
  if (elapsed < 0) return "Active now";
  if (elapsed < MINUTE) return "Active just now";
  if (elapsed < HOUR) return `Active ${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `Active ${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `Active ${Math.floor(elapsed / DAY)}d ago`;
  return null;
}

/** Group the day's messages under one divider. */
export function isSameDay(a: string, b: string): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

/**
 * Whether two consecutive messages should render as one visual group -- same
 * sender, close in time. Signal collapses the bubble corners between these and
 * shows the timestamp only on the last one.
 */
const GROUPING_WINDOW = 5 * MINUTE;

export function shouldGroup(
  previous: { sender_id: string | null; created_at: string; type: string } | undefined,
  current: { sender_id: string | null; created_at: string; type: string },
): boolean {
  if (!previous) return false;
  if (previous.type !== "text" || current.type !== "text") return false;
  if (previous.sender_id !== current.sender_id) return false;
  if (!isSameDay(previous.created_at, current.created_at)) return false;

  const gap =
    new Date(current.created_at).getTime() - new Date(previous.created_at).getTime();
  return gap <= GROUPING_WINDOW;
}

/** The disappearing-message timer labels Signal offers. */
export function formatDuration(seconds: number): string {
  if (seconds === 0) return "Off";
  const units: [number, string][] = [
    [604800, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
    [1, "second"],
  ];
  for (const [size, label] of units) {
    if (seconds >= size && seconds % size === 0) {
      const count = seconds / size;
      return `${count} ${label}${count === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} seconds`;
}

/** "+1 (555) 010-0001" for a stored "+15550100001". */
export function formatPhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}
