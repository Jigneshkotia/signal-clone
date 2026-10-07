"use client";

import { useEffect, useMemo, useState } from "react";

import {
  CheckIcon,
  LeaveIcon,
  PinIcon,
  PlusIcon,
  ShieldIcon,
  TimerIcon,
  XIcon,
} from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ApiError, api } from "@/lib/api";
import { formatDuration, formatPhone, formatPresence } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Conversation, UserPublic } from "@/types/api";

interface ConversationDetailsModalProps {
  conversation: Conversation;
  currentUserId: string;
  onClose: () => void;
  onUpdated: (conversation: Conversation) => void;
  onLeft: (conversationId: string) => void;
  onShowSafetyNumber: () => void;
  onToast: (message: string, tone?: "neutral" | "success" | "error") => void;
}

/** The timer options Signal offers for disappearing messages. */
const TIMER_OPTIONS = [0, 30, 300, 3600, 28800, 86400, 604800];

export function ConversationDetailsModal({
  conversation,
  currentUserId,
  onClose,
  onUpdated,
  onLeft,
  onShowSafetyNumber,
  onToast,
}: ConversationDetailsModalProps) {
  const [renaming, setRenaming] = useState(false);
  // Mounted fresh on open, so seeding from the current title here is safe and
  // needs no effect to keep it in step.
  const [name, setName] = useState(conversation.title);
  const [addingMembers, setAddingMembers] = useState(false);
  const [candidates, setCandidates] = useState<UserPublic[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const isGroup = conversation.type === "group";
  const isAdmin = conversation.my_role === "admin";
  const memberIds = useMemo(
    () => new Set(conversation.members.map((m) => m.user.id)),
    [conversation],
  );

  useEffect(() => {
    if (!addingMembers) return;
    let cancelled = false;
    api.contacts
      .list()
      .then((contacts) => {
        if (cancelled) return;
        setCandidates(
          contacts.map((c) => c.user).filter((u) => !memberIds.has(u.id)),
        );
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [addingMembers, memberIds]);

  const guard = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onToast(
        error instanceof ApiError ? error.message : "Something went wrong",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  const rename = () =>
    guard(async () => {
      const trimmed = name.trim();
      if (!trimmed || trimmed === conversation.title) {
        setRenaming(false);
        return;
      }
      onUpdated(await api.conversations.update(conversation.id, { name: trimmed }));
      setRenaming(false);
      onToast("Group renamed", "success");
    });

  const addMembers = () =>
    guard(async () => {
      if (picked.length === 0) {
        setAddingMembers(false);
        return;
      }
      onUpdated(await api.conversations.addMembers(conversation.id, picked));
      setPicked([]);
      setAddingMembers(false);
      onToast("Members added", "success");
    });

  const removeMember = (userId: string, name: string) =>
    guard(async () => {
      onUpdated(await api.conversations.removeMember(conversation.id, userId));
      onToast(`Removed ${name}`, "success");
    });

  const promote = (userId: string, role: "admin" | "member") =>
    guard(async () => {
      onUpdated(await api.conversations.setRole(conversation.id, userId, role));
      onToast(role === "admin" ? "Promoted to admin" : "Admin removed", "success");
    });

  const leave = () =>
    guard(async () => {
      await api.conversations.removeMember(conversation.id, currentUserId);
      onLeft(conversation.id);
      onClose();
      onToast("You left the group", "neutral");
    });

  const setTimer = (seconds: number) =>
    guard(async () => {
      onUpdated(
        await api.conversations.update(conversation.id, {
          disappear_seconds: seconds,
        }),
      );
    });

  const togglePin = () =>
    guard(async () => {
      onUpdated(
        await api.conversations.setState(conversation.id, {
          is_pinned: !conversation.is_pinned,
        }),
      );
    });

  return (
    <Modal
      open
      onClose={onClose}
      title={isGroup ? "Group details" : "Contact details"}
      width="md"
    >
      <div className="flex flex-col gap-4 pb-4">
        {/* --- Identity ------------------------------------------------- */}
        <div className="flex flex-col items-center gap-2 pt-1">
          <Avatar
            name={conversation.title}
            color={conversation.avatar_color}
            url={conversation.avatar_url}
            size={80}
            isGroup={isGroup}
          />

          {renaming ? (
            <div className="flex w-full max-w-[280px] items-end gap-2">
              <div className="flex-1">
                <Input
                  name="rename"
                  value={name}
                  maxLength={128}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void rename();
                    if (event.key === "Escape") setRenaming(false);
                  }}
                />
              </div>
              <Button size="sm" onClick={rename} loading={busy}>
                Save
              </Button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!isGroup || !isAdmin}
              onClick={() => setRenaming(true)}
              className={cn(
                "rounded-lg px-2 py-0.5 text-[20px] font-semibold leading-[26px] text-primary",
                isGroup && isAdmin && "hover:bg-[var(--surface-hover)]",
              )}
              title={isGroup && isAdmin ? "Rename group" : undefined}
            >
              {conversation.title}
            </button>
          )}

          {!isGroup && conversation.other_user && (
            <>
              <p className="text-[13px] text-secondary">
                {conversation.other_user.username
                  ? `@${conversation.other_user.username}`
                  : formatPhone(conversation.other_user.phone_number)}
              </p>
              {conversation.other_user.about && (
                <p className="text-center text-[13px] text-secondary">
                  {conversation.other_user.about}
                </p>
              )}
              <p className="text-[12px] text-tertiary">
                {formatPresence(
                  conversation.other_user.is_online,
                  conversation.other_user.last_seen_at,
                ) ?? "Offline"}
              </p>
            </>
          )}

          {isGroup && (
            <p className="text-[13px] text-secondary">
              {conversation.members.length} member
              {conversation.members.length === 1 ? "" : "s"}
            </p>
          )}
        </div>

        {/* --- Actions -------------------------------------------------- */}
        <div className="flex flex-col gap-0.5 border-t border-[var(--border-subtle)] pt-3">
          <Row
            icon={<PinIcon size={17} />}
            label={conversation.is_pinned ? "Unpin chat" : "Pin chat"}
            onClick={togglePin}
          />
          {!isGroup && (
            <Row
              icon={<ShieldIcon size={17} />}
              label="Verify safety number"
              onClick={onShowSafetyNumber}
            />
          )}
        </div>

        {/* --- Disappearing messages ------------------------------------ */}
        <div className="border-t border-[var(--border-subtle)] pt-3">
          <p className="flex items-center gap-2 pb-2 text-[13px] font-medium text-secondary">
            <TimerIcon size={15} />
            Disappearing messages
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TIMER_OPTIONS.map((seconds) => (
              <button
                key={seconds}
                type="button"
                disabled={isGroup && !isAdmin}
                onClick={() => setTimer(seconds)}
                className={cn(
                  "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
                  conversation.disappear_seconds === seconds
                    ? "bg-ultramarine text-white"
                    : "bg-[var(--surface-input)] text-secondary hover:text-primary",
                  isGroup && !isAdmin && "opacity-50",
                )}
              >
                {formatDuration(seconds)}
              </button>
            ))}
          </div>
          <p className="pt-2 text-[12px] leading-[16px] text-tertiary">
            The timer is stored and shown, but messages are not actually removed
            in this build.
          </p>
        </div>

        {/* --- Members -------------------------------------------------- */}
        {isGroup && (
          <div className="border-t border-[var(--border-subtle)] pt-3">
            <div className="flex items-center justify-between pb-1">
              <p className="text-[13px] font-medium text-secondary">Members</p>
              {isAdmin && !addingMembers && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setAddingMembers(true)}
                >
                  <PlusIcon size={14} />
                  Add
                </Button>
              )}
            </div>

            {addingMembers && (
              <div className="mb-2 rounded-lg bg-[var(--surface-hover)] p-2">
                {candidates.length === 0 ? (
                  <p className="px-1 py-2 text-[12px] text-tertiary">
                    Everyone in your contacts is already here.
                  </p>
                ) : (
                  candidates.map((user) => {
                    const checked = picked.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() =>
                          setPicked((current) =>
                            checked
                              ? current.filter((id) => id !== user.id)
                              : [...current, user.id],
                          )
                        }
                        className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-left hover:bg-[var(--surface-active)]"
                      >
                        <Avatar
                          name={user.display_name}
                          color={user.avatar_color}
                          size={32}
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-primary">
                          {user.display_name}
                        </span>
                        <span
                          className={cn(
                            "flex h-4.5 w-4.5 items-center justify-center rounded-full border",
                            checked
                              ? "border-ultramarine bg-ultramarine text-white"
                              : "border-[var(--border-strong)]",
                          )}
                        >
                          {checked && <CheckIcon size={11} strokeWidth={3} />}
                        </span>
                      </button>
                    );
                  })
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAddingMembers(false);
                      setPicked([]);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={addMembers}
                    loading={busy}
                    disabled={picked.length === 0}
                  >
                    Add {picked.length > 0 && picked.length}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-col">
              {conversation.members.map((member) => {
                const isMe = member.user.id === currentUserId;
                return (
                  <div
                    key={member.user.id}
                    className="group flex items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-[var(--surface-hover)]"
                  >
                    <Avatar
                      name={member.user.display_name}
                      color={member.user.avatar_color}
                      url={member.user.avatar_url}
                      size={36}
                      isOnline={member.user.is_online}
                      showPresence
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] leading-[20px] text-primary">
                        {isMe ? "You" : member.user.display_name}
                      </p>
                      {member.role === "admin" && (
                        <p className="text-[12px] leading-[16px] text-tertiary">
                          Admin
                        </p>
                      )}
                    </div>

                    {isAdmin && !isMe && (
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() =>
                            promote(
                              member.user.id,
                              member.role === "admin" ? "member" : "admin",
                            )
                          }
                          className="rounded-full px-2 py-1 text-[12px] text-secondary hover:bg-[var(--surface-active)] hover:text-primary"
                        >
                          {member.role === "admin" ? "Demote" : "Make admin"}
                        </button>
                        <IconButton
                          label={`Remove ${member.user.display_name}`}
                          onClick={() =>
                            removeMember(
                              member.user.id,
                              member.user.display_name,
                            )
                          }
                          className="h-7 w-7 hover:text-accent-red"
                        >
                          <XIcon size={15} />
                        </IconButton>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-[var(--border-subtle)] pt-3">
              <Row
                icon={<LeaveIcon size={17} />}
                label="Leave group"
                danger
                onClick={leave}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Row({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg px-2 py-2.5 text-left text-[14px] leading-[20px]",
        danger
          ? "text-accent-red hover:bg-accent-red/10"
          : "text-primary hover:bg-[var(--surface-hover)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
