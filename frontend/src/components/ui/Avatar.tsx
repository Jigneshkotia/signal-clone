import { GroupIcon, PersonIcon } from "@/components/icons";
import { hexFor, initials } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { AvatarColor } from "@/types/api";

interface AvatarProps {
  name: string;
  /** Stored colour name; falls back to Signal's steel. */
  color?: AvatarColor | string | null;
  url?: string | null;
  /** Signal's sizes: 28 in group bubbles, 48 in the chat list, 80 in profiles. */
  size?: number;
  isGroup?: boolean;
  /** Renders the green presence dot. Omit entirely for groups. */
  isOnline?: boolean;
  showPresence?: boolean;
  className?: string;
}

export function Avatar({
  name,
  color,
  url,
  size = 48,
  isGroup = false,
  isOnline = false,
  showPresence = false,
  className,
}: AvatarProps) {
  const background = hexFor(color);
  // Signal scales the initials to a little under half the avatar.
  const fontSize = Math.round(size * 0.4);
  const glyphSize = Math.round(size * 0.52);
  const label = initials(name);

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {url ? (
        /* Avatars are remote or data URLs of unknown origin and are
           rendered at a fixed small size, so next/image adds nothing here. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full text-on-color select-none"
          style={{ backgroundColor: background }}
        >
          {isGroup ? (
            <GroupIcon size={glyphSize} strokeWidth={1.6} />
          ) : label === "#" ? (
            <PersonIcon size={glyphSize} strokeWidth={1.6} />
          ) : (
            <span style={{ fontSize, lineHeight: 1, fontWeight: 500 }}>
              {label}
            </span>
          )}
        </div>
      )}

      {showPresence && !isGroup && isOnline && (
        <span
          // The ring matches the surface behind the avatar so the dot reads as
          // punched out of it, as Signal draws it.
          className="absolute bottom-0 right-0 rounded-full bg-accent-green ring-2 ring-[var(--surface-pane)]"
          style={{
            width: Math.max(10, Math.round(size * 0.26)),
            height: Math.max(10, Math.round(size * 0.26)),
          }}
          aria-label="Online"
        />
      )}
    </div>
  );
}
