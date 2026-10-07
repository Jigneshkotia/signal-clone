"use client";

import { useState } from "react";

import {
  BellIcon,
  ChevronRightIcon,
  LockIcon,
  LogOutIcon,
  MoonIcon,
  PaletteIcon,
  PersonIcon,
  SunIcon,
} from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { CONVERSATION_COLORS } from "@/lib/colors";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { useUiStore, type Theme } from "@/store/uiStore";
import type { AvatarColor } from "@/types/api";

interface SettingsModalProps {
  onClose: () => void;
  onUnsupported: (feature: string) => void;
}

type Tab = "profile" | "appearance" | "privacy" | "notifications";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "profile", label: "Profile", icon: <PersonIcon size={18} /> },
  { id: "appearance", label: "Appearance", icon: <PaletteIcon size={18} /> },
  { id: "privacy", label: "Privacy", icon: <LockIcon size={18} /> },
  { id: "notifications", label: "Notifications", icon: <BellIcon size={18} /> },
];

export function SettingsModal({ onClose, onUnsupported }: SettingsModalProps) {
  // Mounted fresh on open, so the dialog always starts on the Profile tab
  // without an effect to put it back there.
  const [tab, setTab] = useState<Tab>("profile");
  const user = useAuthStore((state) => state.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const logout = useAuthStore((state) => state.logout);
  const toast = useUiStore((state) => state.toast);

  if (!user) return null;

  return (
    <Modal open onClose={onClose} title="Settings" width="lg">
      <div className="flex flex-col gap-4 pb-4 sm:flex-row">
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto sm:w-[150px] sm:flex-col"
          aria-label="Settings sections"
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id ? "true" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium",
                tab === item.id
                  ? "bg-[var(--surface-active)] text-primary"
                  : "text-secondary hover:bg-[var(--surface-hover)] hover:text-primary",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {tab === "profile" && (
            <ProfileTab
              onSave={async (payload) => {
                await updateProfile(payload);
                toast("Profile updated", "success");
              }}
              onLogout={async () => {
                await logout();
                onClose();
              }}
            />
          )}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "privacy" && <PrivacyTab onUnsupported={onUnsupported} />}
          {tab === "notifications" && (
            <NotificationsTab onUnsupported={onUnsupported} />
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function ProfileTab({
  onSave,
  onLogout,
}: {
  onSave: (payload: {
    display_name?: string;
    about?: string | null;
    avatar_color?: string;
  }) => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const user = useAuthStore((state) => state.user)!;
  const [displayName, setDisplayName] = useState(user.display_name);
  const [about, setAbout] = useState(user.about ?? "");
  const [color, setColor] = useState<AvatarColor>(user.avatar_color);
  const [busy, setBusy] = useState(false);

  const dirty =
    displayName.trim() !== user.display_name ||
    about !== (user.about ?? "") ||
    color !== user.avatar_color;

  const save = async () => {
    if (!displayName.trim()) return;
    setBusy(true);
    try {
      await onSave({
        display_name: displayName.trim(),
        about: about.trim() || null,
        avatar_color: color,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Avatar
          name={displayName || user.display_name}
          color={color}
          url={user.avatar_url}
          size={64}
        />
        <div className="min-w-0">
          <p className="truncate text-[16px] font-semibold text-primary">
            {displayName || user.display_name}
          </p>
          <p className="text-[12px] text-secondary">
            {user.username ? `@${user.username}` : formatPhone(user.phone_number)}
          </p>
        </div>
      </div>

      <Input
        name="display-name"
        label="Display name"
        value={displayName}
        maxLength={128}
        onChange={(event) => setDisplayName(event.target.value)}
      />

      <Input
        name="about"
        label="About"
        hint="A short line shown on your profile."
        value={about}
        maxLength={256}
        onChange={(event) => setAbout(event.target.value)}
      />

      <div>
        <p className="pb-2 text-[13px] font-medium text-secondary">
          Avatar colour
        </p>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CONVERSATION_COLORS) as AvatarColor[]).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setColor(name)}
              aria-label={name}
              aria-pressed={color === name}
              className={cn(
                "h-7 w-7 rounded-full transition-transform",
                color === name &&
                  "ring-2 ring-ultramarine ring-offset-2 ring-offset-[var(--surface-raised)]",
              )}
              style={{ backgroundColor: CONVERSATION_COLORS[name] }}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-4">
        <Button variant="danger" onClick={() => void onLogout()}>
          <LogOutIcon size={16} />
          Sign out
        </Button>
        <Button onClick={save} loading={busy} disabled={!dirty}>
          Save
        </Button>
      </div>
    </div>
  );
}

function AppearanceTab() {
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);

  const options: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: "light", label: "Light", icon: <SunIcon size={17} /> },
    { id: "dark", label: "Dark", icon: <MoonIcon size={17} /> },
    { id: "system", label: "System", icon: <PaletteIcon size={17} /> },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="pb-2 text-[13px] font-medium text-secondary">Theme</p>
        <div className="flex flex-col gap-1">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTheme(option.id)}
              aria-pressed={theme === option.id}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px]",
                theme === option.id
                  ? "bg-[var(--surface-active)] text-primary"
                  : "text-secondary hover:bg-[var(--surface-hover)] hover:text-primary",
              )}
            >
              {option.icon}
              <span className="flex-1">{option.label}</span>
              {theme === option.id && (
                <span className="h-2 w-2 rounded-full bg-ultramarine" />
              )}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12px] leading-[16px] text-tertiary">
        “System” follows your operating system setting and updates live.
      </p>
    </div>
  );
}

function PrivacyTab({
  onUnsupported,
}: {
  onUnsupported: (feature: string) => void;
}) {
  const user = useAuthStore((state) => state.user)!;

  return (
    <div className="flex flex-col gap-1">
      <div className="mb-2 rounded-lg bg-[var(--surface-hover)] p-3">
        <p className="flex items-center gap-2 text-[13px] font-medium text-primary">
          <LockIcon size={15} />
          Simulated encryption
        </p>
        <p className="mt-1 text-[12px] leading-[16px] text-secondary">
          This build mimics Signal&apos;s safety-number experience but does not
          implement the Signal protocol. Message bodies are recoverable in the
          database.
        </p>
        <p className="mt-2 break-all font-mono text-[11px] leading-[15px] text-tertiary">
          Identity key: {user.identity_key.slice(0, 32)}…
        </p>
      </div>

      <SettingRow
        label="Read receipts"
        detail="On — senders see when you've read a message"
        onClick={() => onUnsupported("Toggling read receipts")}
      />
      <SettingRow
        label="Typing indicators"
        detail="On"
        onClick={() => onUnsupported("Toggling typing indicators")}
      />
      <SettingRow
        label="Screen lock"
        detail="Off"
        onClick={() => onUnsupported("Screen lock")}
      />
      <SettingRow
        label="Blocked people"
        detail="None"
        onClick={() => onUnsupported("Blocking")}
      />
    </div>
  );
}

function NotificationsTab({
  onUnsupported,
}: {
  onUnsupported: (feature: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <SettingRow
        label="Message notifications"
        detail="On"
        onClick={() => onUnsupported("Notification settings")}
      />
      <SettingRow
        label="Show message preview"
        detail="Name and message"
        onClick={() => onUnsupported("Notification previews")}
      />
      <SettingRow
        label="Notification sound"
        detail="Default"
        onClick={() => onUnsupported("Notification sounds")}
      />
    </div>
  );
}

function SettingRow({
  label,
  detail,
  onClick,
}: {
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-[var(--surface-hover)]"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-[20px] text-primary">
          {label}
        </span>
        <span className="block text-[12px] leading-[16px] text-secondary">
          {detail}
        </span>
      </span>
      <ChevronRightIcon size={16} className="shrink-0 text-tertiary" />
    </button>
  );
}
