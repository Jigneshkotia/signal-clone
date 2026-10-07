"use client";

import { useEffect, useState } from "react";

import { ShieldIcon } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import type { SafetyNumber } from "@/types/api";

interface SafetyNumberModalProps {
  conversationId: string | null;
  title: string;
  onClose: () => void;
}

/**
 * Signal's safety-number screen: sixty digits in twelve groups of five, which
 * both participants compare out of band.
 *
 * The number here is derived from the two mocked identity keys (sorted, then
 * hashed), so both sides genuinely compute the same value -- the one property
 * that makes the comparison meaningful. It is still not real cryptography.
 */
export function SafetyNumberModal({
  conversationId,
  title,
  onClose,
}: SafetyNumberModalProps) {
  const [data, setData] = useState<SafetyNumber | null>(null);
  // Derived at mount rather than in an effect: there is a fetch to do exactly
  // when there is a conversation to fetch for.
  const [loading, setLoading] = useState(Boolean(conversationId));

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    api.conversations
      .safetyNumber(conversationId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  return (
    <Modal
      open
      onClose={onClose}
      title="Verify safety number"
      width="sm"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-4 pb-4">
        {loading ? (
          <div className="py-10">
            <Spinner size={22} className="text-tertiary" />
          </div>
        ) : data ? (
          <>
            <div className="grid grid-cols-4 gap-x-5 gap-y-2.5 rounded-xl bg-[var(--surface-hover)] px-5 py-5">
              {data.groups.map((group, index) => (
                <span
                  key={`${group}-${index}`}
                  className="font-mono text-[16px] leading-[20px] tracking-wide text-primary tabular-nums"
                >
                  {group}
                </span>
              ))}
            </div>

            <p className="text-center text-[13px] leading-[18px] text-secondary">
              Compare these numbers with {title}&apos;s device. If they match,
              your conversation is secure.
            </p>

            <div className="flex w-full items-start gap-2 rounded-lg bg-ultramarine/10 p-3">
              <ShieldIcon size={16} className="mt-px shrink-0 text-ultramarine" />
              <p className="text-[12px] leading-[16px] text-secondary">
                Simulated. Both sides derive this from hashed mock identity keys,
                so the number matches — but no Signal-protocol session exists.
              </p>
            </div>
          </>
        ) : (
          <p className="py-10 text-[13px] text-tertiary">
            Could not load the safety number.
          </p>
        )}
      </div>
    </Modal>
  );
}
