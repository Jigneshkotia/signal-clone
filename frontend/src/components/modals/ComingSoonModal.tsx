"use client";

import { SparkleIcon } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface ComingSoonModalProps {
  feature: string;
  onClose: () => void;
}

/**
 * Placeholder for the features the assignment scopes out: calls, stories,
 * linked devices, attachments. Named explicitly so it is clear what was left
 * out on purpose rather than missed.
 */
export function ComingSoonModal({ feature, onClose }: ComingSoonModalProps) {
  return (
    <Modal
      open
      onClose={onClose}
      width="sm"
      footer={
        <Button onClick={onClose} variant="primary">
          Got it
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ultramarine/10">
          <SparkleIcon size={26} className="text-ultramarine" />
        </div>
        <h2 className="text-[18px] font-semibold leading-[25px] text-primary">
          {feature} — coming soon
        </h2>
        <p className="max-w-[300px] text-[13px] leading-[18px] text-secondary">
          This part of Signal is a placeholder in this build. Messaging, groups,
          receipts, and reactions are all fully implemented.
        </p>
      </div>
    </Modal>
  );
}
