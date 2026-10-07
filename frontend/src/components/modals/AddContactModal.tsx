"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface AddContactModalProps {
  onClose: () => void;
  onAdded: (name: string) => void;
}

type Mode = "phone" | "username";

export function AddContactModal({ onClose, onAdded }: AddContactModalProps) {
  // Mounted fresh each time it opens, so these initialisers *are* the reset.
  const [mode, setMode] = useState<Mode>("phone");
  const [value, setValue] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed) {
      setError(
        mode === "phone" ? "Enter a phone number" : "Enter a username",
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const contact = await api.contacts.add({
        [mode === "phone" ? "phone_number" : "username"]: trimmed,
        nickname: nickname.trim() || undefined,
      });
      onAdded(contact.nickname ?? contact.user.display_name);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not add contact",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a contact"
      description="Find someone by phone number or username."
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-4">
        <div className="flex gap-1 rounded-full bg-[var(--surface-input)] p-1">
          {(["phone", "username"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setMode(option);
                setError(null);
              }}
              className={cn(
                "flex-1 rounded-full py-1.5 text-[13px] font-medium capitalize transition-colors",
                mode === option
                  ? "bg-ultramarine text-white"
                  : "text-secondary hover:text-primary",
              )}
            >
              {option === "phone" ? "Phone number" : "Username"}
            </button>
          ))}
        </div>

        <Input
          name="identifier"
          label={mode === "phone" ? "Phone number" : "Username"}
          placeholder={mode === "phone" ? "+1 555 010 0002" : "aisha"}
          value={value}
          error={error}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />

        <Input
          name="nickname"
          label="Nickname (optional)"
          hint="Only you see this name."
          placeholder="What you call them"
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
        />
      </div>
    </Modal>
  );
}
