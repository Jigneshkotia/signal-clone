"""The receipt aggregation rules -- the core of the delivery/read experience."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.models import MessageStatus, User
from app.services import conversation_service, message_service
from tests.conftest import make_group


def test_new_message_opens_a_receipt_for_every_other_member(
    db: Session, alice: User, bob: User, carol: User
) -> None:
    group = make_group(db, "Trip", [alice, bob, carol], admin=alice)

    message, created = message_service.create_message(
        db, conversation=group, sender=alice, body="Hello everyone"
    )

    assert created is True
    # The sender never gets a receipt row -- only the two recipients.
    assert {r.user_id for r in message.receipts} == {bob.id, carol.id}
    assert message.status == MessageStatus.SENT


def test_group_status_only_advances_when_every_member_has_acted(
    db: Session, alice: User, bob: User, carol: User
) -> None:
    """The property a single status column could not express."""
    group = make_group(db, "Trip", [alice, bob, carol], admin=alice)
    message, _ = message_service.create_message(
        db, conversation=group, sender=alice, body="Status check"
    )

    # One of two recipients receives it: still SENT, not DELIVERED.
    message_service.mark_delivered(db, user_id=bob.id, message_ids=[message.id])
    db.refresh(message)
    assert message.status == MessageStatus.SENT

    # Both have it: now DELIVERED.
    message_service.mark_delivered(db, user_id=carol.id, message_ids=[message.id])
    db.refresh(message)
    assert message.status == MessageStatus.DELIVERED

    # One reads: still DELIVERED.
    message_service.mark_read(
        db, user_id=bob.id, conversation_id=group.id, up_to_message_id=message.id
    )
    db.refresh(message)
    assert message.status == MessageStatus.DELIVERED

    # Both read: READ.
    message_service.mark_read(
        db, user_id=carol.id, conversation_id=group.id, up_to_message_id=message.id
    )
    db.refresh(message)
    assert message.status == MessageStatus.READ


def test_reading_backfills_delivery(db: Session, alice: User, bob: User) -> None:
    """Opening a chat implies receipt, so a read must never leave delivery unset."""
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)
    message, _ = message_service.create_message(
        db, conversation=conversation, sender=alice, body="Straight to read"
    )

    message_service.mark_read(
        db, user_id=bob.id, conversation_id=conversation.id, up_to_message_id=message.id
    )
    db.refresh(message)

    receipt = message.receipts[0]
    assert receipt.delivered_at is not None
    assert receipt.read_at is not None
    assert message.status == MessageStatus.READ


def test_message_with_no_other_members_is_sent(db: Session, alice: User) -> None:
    """A Note to Self thread has nobody to deliver to; it must not hang on SENDING."""
    conversation, _ = conversation_service.get_or_create_direct(db, alice, alice.id)
    message, _ = message_service.create_message(
        db, conversation=conversation, sender=alice, body="Note to self"
    )

    assert message.receipts == []
    assert message_service.derive_status(message) == MessageStatus.SENT


def test_mark_read_only_affects_messages_up_to_the_cutoff(
    db: Session, alice: User, bob: User
) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)
    first, _ = message_service.create_message(
        db, conversation=conversation, sender=alice, body="first"
    )
    second, _ = message_service.create_message(
        db, conversation=conversation, sender=alice, body="second"
    )

    message_service.mark_read(
        db, user_id=bob.id, conversation_id=conversation.id, up_to_message_id=first.id
    )
    db.refresh(first)
    db.refresh(second)

    assert first.status == MessageStatus.READ
    assert second.status == MessageStatus.SENT


def test_mark_read_rejects_a_non_member(db: Session, alice: User, bob: User, carol: User) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)

    with pytest.raises(message_service.MessageError) as caught:
        message_service.mark_read(
            db, user_id=carol.id, conversation_id=conversation.id
        )
    assert caught.value.status_code == 403
