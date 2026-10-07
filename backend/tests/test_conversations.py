"""Conversation creation, unread counts, and group administration."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.models import ConversationType, MemberRole, User
from app.schemas.conversation import ConversationUpdate, GroupConversationCreate
from app.services import conversation_service, message_service
from tests.conftest import make_group


# --------------------------------------------------------------------------- #
# Direct conversations
# --------------------------------------------------------------------------- #


def test_direct_conversation_is_idempotent(db: Session, alice: User, bob: User) -> None:
    """Opening the same chat twice must never fork a second thread."""
    first, created_first = conversation_service.get_or_create_direct(db, alice, bob.id)
    second, created_second = conversation_service.get_or_create_direct(db, alice, bob.id)

    assert created_first is True
    assert created_second is False
    assert first.id == second.id


def test_direct_conversation_is_found_from_either_side(
    db: Session, alice: User, bob: User
) -> None:
    created, _ = conversation_service.get_or_create_direct(db, alice, bob.id)
    # Bob opening it from his side must land on the same row.
    from_bob, was_created = conversation_service.get_or_create_direct(db, bob, alice.id)

    assert was_created is False
    assert from_bob.id == created.id


def test_note_to_self_is_its_own_thread(db: Session, alice: User, bob: User) -> None:
    with_bob, _ = conversation_service.get_or_create_direct(db, alice, bob.id)
    with_self, _ = conversation_service.get_or_create_direct(db, alice, alice.id)

    assert with_self.id != with_bob.id
    assert with_self.member_ids() == [alice.id]
    assert conversation_service.serialize(db, with_self, alice.id).title == "Note to Self"


# --------------------------------------------------------------------------- #
# Unread counts
# --------------------------------------------------------------------------- #


def test_unread_counts_only_other_peoples_messages(
    db: Session, alice: User, bob: User
) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)

    for body in ("one", "two", "three"):
        message_service.create_message(
            db, conversation=conversation, sender=bob, body=body
        )
    message_service.create_message(
        db, conversation=conversation, sender=alice, body="mine"
    )

    alice_view = conversation_service.serialize(db, conversation, alice.id)
    bob_view = conversation_service.serialize(db, conversation, bob.id)

    # Alice sending resets her own watermark, so her three unread are cleared.
    assert alice_view.unread_count == 0
    # Bob has Alice's one message outstanding.
    assert bob_view.unread_count == 1


def test_reading_clears_the_unread_count(db: Session, alice: User, bob: User) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)
    for body in ("a", "b"):
        message_service.create_message(
            db, conversation=conversation, sender=bob, body=body
        )

    assert conversation_service.serialize(db, conversation, alice.id).unread_count == 2

    message_service.mark_read(db, user_id=alice.id, conversation_id=conversation.id)
    db.refresh(conversation)

    assert conversation_service.serialize(db, conversation, alice.id).unread_count == 0


def test_system_messages_do_not_count_as_unread(
    db: Session, alice: User, bob: User
) -> None:
    group = make_group(db, "Trip", [alice, bob], admin=alice)
    message_service.create_system_message(
        db, conversation=group, body="Alice created the group"
    )

    assert conversation_service.serialize(db, group, bob.id).unread_count == 0


# --------------------------------------------------------------------------- #
# Groups
# --------------------------------------------------------------------------- #


def test_group_creator_becomes_admin(db: Session, alice: User, bob: User) -> None:
    group = conversation_service.create_group(
        db,
        alice,
        GroupConversationCreate(name="Design", member_ids=[bob.id]),
    )

    assert group.type == ConversationType.GROUP
    roles = {m.user_id: m.role for m in group.members}
    assert roles[alice.id] == MemberRole.ADMIN
    assert roles[bob.id] == MemberRole.MEMBER


def test_only_admins_can_rename_a_group(db: Session, alice: User, bob: User) -> None:
    group = make_group(db, "Original", [alice, bob], admin=alice)

    with pytest.raises(conversation_service.ConversationError) as caught:
        conversation_service.update_group(
            db, group, bob, ConversationUpdate(name="Hijacked")
        )
    assert caught.value.status_code == 403

    updated, notices = conversation_service.update_group(
        db, group, alice, ConversationUpdate(name="Renamed")
    )
    assert updated.name == "Renamed"
    assert any("Renamed" in notice for notice in notices)


def test_only_admins_can_remove_other_members(
    db: Session, alice: User, bob: User, carol: User
) -> None:
    group = make_group(db, "Trip", [alice, bob, carol], admin=alice)

    with pytest.raises(conversation_service.ConversationError) as caught:
        conversation_service.remove_member(db, group, bob, carol.id)
    assert caught.value.status_code == 403


def test_anyone_can_remove_themselves(db: Session, alice: User, bob: User) -> None:
    group = make_group(db, "Trip", [alice, bob], admin=alice)

    updated, notices = conversation_service.remove_member(db, group, bob, bob.id)

    assert bob.id not in updated.member_ids()
    assert "left the group" in notices[0]


def test_removing_the_last_admin_promotes_a_successor(
    db: Session, alice: User, bob: User, carol: User
) -> None:
    """A group must never be left with nobody able to administer it."""
    group = make_group(db, "Trip", [alice, bob, carol], admin=alice)

    conversation_service.remove_member(db, group, alice, alice.id)
    db.refresh(group)

    admins = [m for m in group.members if m.is_admin]
    assert len(admins) == 1
    assert admins[0].user_id in {bob.id, carol.id}


def test_cannot_demote_the_only_admin(db: Session, alice: User, bob: User) -> None:
    group = make_group(db, "Trip", [alice, bob], admin=alice)

    with pytest.raises(conversation_service.ConversationError) as caught:
        conversation_service.set_member_role(db, group, alice, alice.id, MemberRole.MEMBER)
    assert caught.value.status_code == 422


def test_non_members_cannot_read_a_conversation(
    db: Session, alice: User, bob: User, carol: User
) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)

    with pytest.raises(conversation_service.ConversationError) as caught:
        conversation_service.get_for_user(db, conversation.id, carol.id)
    # 404 rather than 403: an outsider learns nothing about whether it exists.
    assert caught.value.status_code == 404


def test_contact_nickname_overrides_the_display_name(
    db: Session, alice: User, bob: User
) -> None:
    from app.models import Contact

    db.add(Contact(owner_id=alice.id, contact_user_id=bob.id, nickname="Bobby"))
    db.commit()

    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)

    # Only the person who set the nickname sees it.
    assert conversation_service.serialize(db, conversation, alice.id).title == "Bobby"
    assert (
        conversation_service.serialize(db, conversation, bob.id).title
        == alice.display_name
    )
