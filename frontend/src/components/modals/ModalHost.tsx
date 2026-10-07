"use client";

import { useRouter } from "next/navigation";

import { AddContactModal } from "@/components/modals/AddContactModal";
import { ComingSoonModal } from "@/components/modals/ComingSoonModal";
import { ConversationDetailsModal } from "@/components/modals/ConversationDetailsModal";
import { NewChatModal } from "@/components/modals/NewChatModal";
import { NewGroupModal } from "@/components/modals/NewGroupModal";
import { SafetyNumberModal } from "@/components/modals/SafetyNumberModal";
import { SettingsModal } from "@/components/modals/SettingsModal";
import { ApiError, api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
import { useChatStore } from "@/store/chatStore";
import { useUiStore } from "@/store/uiStore";

/**
 * Single mount point for every dialog.
 *
 * Keeping them here rather than scattered through the tree means only one
 * component knows which modal is open, and any of them can be opened from
 * anywhere with `openModal(...)`.
 */
export function ModalHost() {
  const router = useRouter();

  const modal = useUiStore((state) => state.modal);
  const payload = useUiStore((state) => state.modalPayload);
  const openModal = useUiStore((state) => state.openModal);
  const closeModal = useUiStore((state) => state.closeModal);
  const toast = useUiStore((state) => state.toast);
  const setMobilePane = useUiStore((state) => state.setMobilePane);

  const user = useAuthStore((state) => state.user);
  const conversations = useChatStore((state) => state.conversations);
  const activeId = useChatStore((state) => state.activeId);
  const upsertConversation = useChatStore((state) => state.upsertConversation);
  const removeConversation = useChatStore((state) => state.removeConversation);

  // The details and safety-number dialogs are opened with a conversation id,
  // falling back to whichever conversation is on screen.
  const targetId =
    typeof payload === "string" && payload.length > 20 ? payload : activeId;
  const target = conversations.find((c) => c.id === targetId);

  const goToConversation = (id: string) => {
    closeModal();
    setMobilePane("chat");
    router.push(`/chat/${id}`);
  };

  const startDirect = async (userId: string) => {
    try {
      const conversation = await api.conversations.createDirect(userId);
      upsertConversation(conversation);
      goToConversation(conversation.id);
    } catch (error) {
      toast(
        error instanceof ApiError ? error.message : "Could not open that chat",
        "error",
      );
    }
  };

  if (!user) return null;

  /*
   * Each dialog is mounted only while it is open.
   *
   * That is what keeps its internal form state correct without any
   * reset-on-open effects: opening a dialog mounts a fresh component, so
   * `useState` initialisers run against the current data and closing it throws
   * the state away. Syncing the same thing with `useEffect` would be both more
   * code and a render behind.
   */
  return (
    <>
      {modal === "new-chat" && (
        <NewChatModal
          onClose={closeModal}
          onStartDirect={(userId) => void startDirect(userId)}
          onNewGroup={() => openModal("new-group")}
          onAddContact={() => openModal("add-contact")}
        />
      )}

      {modal === "new-group" && (
        <NewGroupModal
          onClose={closeModal}
          onCreated={(conversationId) => {
            toast("Group created", "success");
            goToConversation(conversationId);
          }}
          onError={(message) => toast(message, "error")}
        />
      )}

      {modal === "add-contact" && (
        <AddContactModal
          onClose={closeModal}
          onAdded={(name) => {
            toast(`${name} added to contacts`, "success");
            openModal("new-chat");
          }}
        />
      )}

      {modal === "settings" && (
        <SettingsModal
          onClose={closeModal}
          onUnsupported={(feature) => openModal("coming-soon", feature)}
        />
      )}

      {modal === "group-details" && target && (
        <ConversationDetailsModal
          conversation={target}
          currentUserId={user.id}
          onClose={closeModal}
          onUpdated={upsertConversation}
          onLeft={(conversationId) => {
            removeConversation(conversationId);
            router.push("/chat");
          }}
          onShowSafetyNumber={() => openModal("safety-number", target.id)}
          onToast={toast}
        />
      )}

      {modal === "safety-number" && (
        <SafetyNumberModal
          conversationId={target?.id ?? null}
          title={target?.title ?? "this contact"}
          onClose={closeModal}
        />
      )}

      {modal === "coming-soon" && (
        <ComingSoonModal
          feature={typeof payload === "string" ? payload : "This feature"}
          onClose={closeModal}
        />
      )}
    </>
  );
}
