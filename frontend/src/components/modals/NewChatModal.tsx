"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { GroupIcon, PersonIcon, SearchIcon } from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { SearchInput } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { formatPhone } from "@/lib/format";
import type { Contact, UserPublic } from "@/types/api";

interface NewChatModalProps {
  onClose: () => void;
  onStartDirect: (userId: string) => void;
  onNewGroup: () => void;
  onAddContact: () => void;
}

/** Wait this long after the last keystroke before searching the directory. */
const SEARCH_DEBOUNCE = 250;
const MIN_SEARCH_LENGTH = 2;

/**
 * Signal's compose screen: two actions at the top, then your contacts, with a
 * live directory search once you type.
 */
export function NewChatModal({
  onClose,
  onStartDirect,
  onNewGroup,
  onAddContact,
}: NewChatModalProps) {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [results, setResults] = useState<UserPublic[]>([]);
  const [searching, setSearching] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Guards against a slow earlier request landing after a newer one. */
  const searchSeq = useRef(0);

  // Load the address book once, on open.
  useEffect(() => {
    let cancelled = false;
    api.contacts
      .list()
      .then((list) => {
        if (!cancelled) setContacts(list);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  /*
   * Debounce in the change handler rather than in an effect keyed on `query`.
   * The search is a reaction to typing, not a property of the query, so driving
   * it from the event keeps the request out of the render cycle.
   */
  const handleQueryChange = (next: string) => {
    setQuery(next);
    if (searchTimer.current) clearTimeout(searchTimer.current);

    const term = next.trim();
    if (term.length < MIN_SEARCH_LENGTH) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const seq = ++searchSeq.current;
    searchTimer.current = setTimeout(() => {
      api.users
        .search(term)
        .then((found) => {
          if (seq === searchSeq.current) setResults(found);
        })
        .catch(() => {
          if (seq === searchSeq.current) setResults([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE);
  };

  /** Contacts matching the query, shown above directory results. */
  const filteredContacts = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return contacts;
    return contacts.filter((contact) => {
      const name = contact.nickname ?? contact.user.display_name;
      return (
        name.toLowerCase().includes(term) ||
        contact.user.username?.toLowerCase().includes(term) ||
        contact.user.phone_number?.includes(term)
      );
    });
  }, [contacts, query]);

  const contactIds = new Set(contacts.map((c) => c.user.id));
  const others = results.filter((user) => !contactIds.has(user.id));

  return (
    <Modal open onClose={onClose} title="New chat" width="md">
      <div className="pb-4">
        <SearchInput
          value={query}
          onChange={handleQueryChange}
          placeholder="Search by name, username, or number"
          className="mb-3"
        />

        {!query && (
          <div className="mb-2">
            <ActionRow
              icon={<GroupIcon size={20} />}
              label="New group"
              onClick={onNewGroup}
            />
            <ActionRow
              icon={<PersonIcon size={20} />}
              label="Add a contact"
              onClick={onAddContact}
            />
          </div>
        )}

        {filteredContacts.length > 0 && (
          <Section title="Contacts">
            {filteredContacts.map((contact) => (
              <PersonRow
                key={contact.id}
                user={contact.user}
                nickname={contact.nickname}
                onClick={() => onStartDirect(contact.user.id)}
              />
            ))}
          </Section>
        )}

        {searching && (
          <div className="flex justify-center py-4">
            <Spinner size={18} className="text-tertiary" />
          </div>
        )}

        {others.length > 0 && (
          <Section title="Other people">
            {others.map((user) => (
              <PersonRow
                key={user.id}
                user={user}
                onClick={() => onStartDirect(user.id)}
              />
            ))}
          </Section>
        )}

        {query.trim().length >= MIN_SEARCH_LENGTH &&
          !searching &&
          filteredContacts.length === 0 &&
          others.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-8 text-center">
              <SearchIcon size={22} className="text-tertiary" />
              <p className="text-[13px] text-secondary">
                No one found for “{query.trim()}”
              </p>
            </div>
          )}
      </div>
    </Modal>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <h3 className="px-2 pb-1 pt-2 text-[12px] font-medium uppercase tracking-wide text-tertiary">
        {title}
      </h3>
      {children}
    </div>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-[var(--surface-hover)]"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-ultramarine text-white">
        {icon}
      </span>
      <span className="text-[14px] leading-[20px] text-primary">{label}</span>
    </button>
  );
}

function PersonRow({
  user,
  nickname,
  onClick,
}: {
  user: UserPublic;
  nickname?: string | null;
  onClick: () => void;
}) {
  const name = nickname ?? user.display_name;
  const detail = user.username
    ? `@${user.username}`
    : formatPhone(user.phone_number);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--surface-hover)]"
    >
      <Avatar
        name={name}
        color={user.avatar_color}
        url={user.avatar_url}
        size={40}
        isOnline={user.is_online}
        showPresence
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] leading-[20px] text-primary">
          {name}
        </span>
        <span className="block truncate text-[12px] leading-[16px] text-secondary">
          {detail}
        </span>
      </span>
    </button>
  );
}
