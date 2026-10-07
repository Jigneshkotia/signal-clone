"use client";

import {
  ChatsIcon,
  DevicesIcon,
  PhoneIcon,
  SettingsIcon,
  StoriesIcon,
} from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";
import type { UserMe } from "@/types/api";

interface NavRailProps {
  user: UserMe;
  unreadTotal: number;
  onOpenSettings: () => void;
  onUnsupported: (feature: string) => void;
}

/**
 * Signal Desktop's narrow icon rail down the left edge: Chats, Calls, Stories,
 * then Devices and Settings pinned to the bottom with the profile avatar.
 *
 * Only Chats is implemented; the rest open the "Coming Soon" dialog, which the
 * assignment lists as acceptable placeholders.
 */
export function NavRail({
  user,
  unreadTotal,
  onOpenSettings,
  onUnsupported,
}: NavRailProps) {
  return (
    <nav
      className="hidden h-full w-[68px] shrink-0 flex-col items-center gap-1 border-r border-[var(--border-subtle)] bg-pane py-3 md:flex"
      aria-label="Main"
    >
      <RailButton
        label="Chats"
        active
        badge={unreadTotal}
        onClick={() => {}}
      >
        <ChatsIcon size={22} />
      </RailButton>

      <RailButton label="Calls" onClick={() => onUnsupported("Calls")}>
        <PhoneIcon size={22} />
      </RailButton>

      <RailButton label="Stories" onClick={() => onUnsupported("Stories")}>
        <StoriesIcon size={22} />
      </RailButton>

      <div className="flex-1" />

      <RailButton
        label="Linked devices"
        onClick={() => onUnsupported("Linked devices")}
      >
        <DevicesIcon size={22} />
      </RailButton>

      <RailButton label="Settings" onClick={onOpenSettings}>
        <SettingsIcon size={22} />
      </RailButton>

      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Your profile"
        title={user.display_name}
        className="mt-1 rounded-full p-1 hover:bg-[var(--surface-hover)]"
      >
        <Avatar
          name={user.display_name}
          color={user.avatar_color}
          url={user.avatar_url}
          size={28}
        />
      </button>
    </nav>
  );
}

function RailButton({
  label,
  active = false,
  badge = 0,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  badge?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-11 w-11 items-center justify-center rounded-full",
        "transition-colors duration-75",
        active
          ? "bg-[var(--surface-active)] text-primary"
          : "text-secondary hover:bg-[var(--surface-hover)] hover:text-primary",
      )}
    >
      {children}
      {badge > 0 && (
        <span
          className="absolute right-1 top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-ultramarine px-1 text-[10px] font-semibold leading-none text-white tabular-nums"
          aria-label={`${badge} unread`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );
}
