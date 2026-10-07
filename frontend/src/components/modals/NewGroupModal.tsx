"use client";

import { useEffect, useMemo, useState } from "react";

import { CheckIcon, GroupIcon, XIcon } from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input, SearchInput } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Contact, UserPublic } from "@/types/api";

interface NewGroupModalProps {
  onClose: () => void;
  onCreated: (conversationId: string) => void;
  onError: (message: string) => void;
}

export function NewGroupModal({
  onClose,
  onCreated,
  onError,
}: NewGroupModalProps) {
  // Mounted fresh on open, so these initialisers are the reset.
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<UserPublic[]>([]);
  const [selected, setSelected] = useState<UserPublic[]>([]);
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.contacts
      .list()
      .then((contacts: Contact[]) => {
        if (!cancelled) setPeople(contacts.map((c) => c.user));
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return people;
    return people.filter((user) =>
      user.display_name.toLowerCase().includes(term),
    );
  }, [people, query]);

  const toggle = (user: UserPublic) => {
    setSelected((current) =>
      current.some((u) => u.id === user.id)
        ? current.filter((u) => u.id !== user.id)
        : [...current, user],
    );
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Give the group a name");
      return;
    }
    if (selected.length === 0) {
      onError("Add at least one other person");
      return;
    }

    setBusy(true);
    try {
      const conversation = await api.conversations.createGroup({
        name: trimmed,
        member_ids: selected.map((u) => u.id),
      });
      onCreated(conversation.id);
    } catch (error) {
      onError(
        error instanceof ApiError ? error.message : "Could not create the group",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New group"
      description="Groups keep everyone in one conversation."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} loading={busy}>
            Create group
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--surface-active)] text-tertiary">
            <GroupIcon size={26} />
          </span>
          <div className="flex-1">
            <Input
              name="group-name"
              placeholder="Group name"
              value={name}
              maxLength={128}
              error={nameError}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError(null);
              }}
            />
          </div>
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => toggle(user)}
                className="flex items-center gap-1.5 rounded-full bg-[var(--surface-active)] py-1 pl-1 pr-2.5 text-[13px] text-primary hover:bg-[var(--surface-hover)]"
                aria-label={`Remove ${user.display_name}`}
              >
                <Avatar
                  name={user.display_name}
                  color={user.avatar_color}
                  url={user.avatar_url}
                  size={22}
                />
                {user.display_name.split(" ")[0]}
                <XIcon size={12} className="text-tertiary" />
              </button>
            ))}
          </div>
        )}

        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search contacts"
        />

        <div className="-mx-1">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-[13px] text-tertiary">
              {people.length === 0
                ? "Add some contacts first."
                : `No contacts match “${query.trim()}”`}
            </p>
          ) : (
            filtered.map((user) => {
              const checked = selected.some((u) => u.id === user.id);
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => toggle(user)}
                  aria-pressed={checked}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-hover)]"
                >
                  <Avatar
                    name={user.display_name}
                    color={user.avatar_color}
                    url={user.avatar_url}
                    size={40}
                  />
                  <span className="min-w-0 flex-1 truncate text-[14px] leading-[20px] text-primary">
                    {user.display_name}
                  </span>
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                      checked
                        ? "border-ultramarine bg-ultramarine text-white"
                        : "border-[var(--border-strong)]",
                    )}
                  >
                    {checked && <CheckIcon size={13} strokeWidth={2.5} />}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
