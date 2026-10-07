import { Avatar } from "@/components/ui/Avatar";
import type { UserPublic } from "@/types/api";

interface TypingIndicatorProps {
  /** Who is typing. In a group Signal shows their avatars alongside the dots. */
  users: UserPublic[];
  isGroup: boolean;
}

/**
 * Signal renders typing as three bouncing dots inside a normal incoming bubble,
 * pinned to the bottom of the timeline -- not as a status line in the header.
 */
export function TypingIndicator({ users, isGroup }: TypingIndicatorProps) {
  if (users.length === 0) return null;

  return (
    <div className="flex items-end gap-2 px-4 pb-1 pt-0.5">
      {isGroup && (
        <Avatar
          name={users[0].display_name}
          color={users[0].avatar_color}
          url={users[0].avatar_url}
          size={28}
        />
      )}

      <div
        className="flex items-center gap-1 rounded-[18px] bg-bubble-incoming px-3.5 py-3"
        role="status"
        aria-label={
          users.length === 1
            ? `${users[0].display_name} is typing`
            : `${users.length} people are typing`
        }
      >
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="typing-dot block h-[7px] w-[7px] rounded-full bg-[var(--label-secondary)]"
            // Stagger so the dots travel as a wave.
            style={{ animationDelay: `${index * 180}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
