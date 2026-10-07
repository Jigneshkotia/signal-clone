"""Message sending, idempotency, pagination, reactions, and the mocked crypto."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.core import mock_crypto
from app.models import User
from app.services import conversation_service, message_service


def test_resending_a_client_id_is_idempotent(
    db: Session, alice: User, bob: User
) -> None:
    """A retried optimistic send must resolve to the same row, not a duplicate."""
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)

    first, created_first = message_service.create_message(
        db, conversation=conversation, sender=alice, body="Hello", client_id="abc-123"
    )
    second, created_second = message_service.create_message(
        db, conversation=conversation, sender=alice, body="Hello", client_id="abc-123"
    )

    assert created_first is True
    assert created_second is False
    assert first.id == second.id

    page = message_service.get_history(db, conversation.id)
    assert len(page.messages) == 1


def test_message_bodies_round_trip_through_the_mock_cipher(
    db: Session, alice: User, bob: User
) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)
    body = "Readable on the way out, encoded at rest \U0001f512"

    message, _ = message_service.create_message(
        db, conversation=conversation, sender=alice, body=body
    )

    # Stored encoded...
    assert message.body != body
    # ...but served as the original text.
    assert message_service.serialize_message(message).body == body


def test_history_paginates_backwards_without_gaps(
    db: Session, alice: User, bob: User
) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)
    for index in range(25):
        message_service.create_message(
            db, conversation=conversation, sender=alice, body=f"message {index}"
        )

    first_page = message_service.get_history(db, conversation.id, limit=10)
    assert len(first_page.messages) == 10
    assert first_page.has_more is True
    # Pages come back chronologically, so the newest is last.
    assert first_page.messages[-1].body == "message 24"

    second_page = message_service.get_history(
        db, conversation.id, before=first_page.next_cursor, limit=10
    )
    assert len(second_page.messages) == 10

    ids = {m.id for m in first_page.messages} | {m.id for m in second_page.messages}
    assert len(ids) == 20  # no overlap between pages

    last_page = message_service.get_history(
        db, conversation.id, before=second_page.next_cursor, limit=10
    )
    assert last_page.has_more is False
    assert len(last_page.messages) == 5


def test_one_reaction_per_person_and_toggling_clears_it(
    db: Session, alice: User, bob: User
) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)
    message, _ = message_service.create_message(
        db, conversation=conversation, sender=alice, body="React to me"
    )

    message_service.set_reaction(db, message=message, user_id=bob.id, emoji="❤️")
    assert [r.emoji for r in message.reactions] == ["❤️"]

    # A different emoji replaces rather than adding a second.
    message_service.set_reaction(db, message=message, user_id=bob.id, emoji="\U0001f44d")
    assert [r.emoji for r in message.reactions] == ["\U0001f44d"]

    # Re-sending the same emoji removes it.
    message_service.set_reaction(db, message=message, user_id=bob.id, emoji="\U0001f44d")
    assert message.reactions == []


def test_reply_must_target_the_same_conversation(
    db: Session, alice: User, bob: User, carol: User
) -> None:
    here, _ = conversation_service.get_or_create_direct(db, alice, bob.id)
    elsewhere, _ = conversation_service.get_or_create_direct(db, alice, carol.id)

    foreign, _ = message_service.create_message(
        db, conversation=elsewhere, sender=alice, body="over there"
    )

    with pytest.raises(message_service.MessageError) as caught:
        message_service.create_message(
            db, conversation=here, sender=alice, body="reply", reply_to_id=foreign.id
        )
    assert caught.value.status_code == 422


def test_only_the_sender_can_delete_a_message(
    db: Session, alice: User, bob: User
) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)
    message, _ = message_service.create_message(
        db, conversation=conversation, sender=alice, body="Mine to delete"
    )

    with pytest.raises(message_service.MessageError) as caught:
        message_service.soft_delete(db, message=message, user_id=bob.id)
    assert caught.value.status_code == 403

    deleted = message_service.soft_delete(db, message=message, user_id=alice.id)
    # Soft delete: the row survives so the bubble can say so.
    assert deleted.deleted_at is not None
    assert message_service.serialize_message(deleted).body == ""


def test_sending_bumps_the_conversation_sort_key(
    db: Session, alice: User, bob: User
) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)
    assert conversation.last_message_at is None

    message, _ = message_service.create_message(
        db, conversation=conversation, sender=alice, body="bump"
    )
    db.refresh(conversation)

    assert conversation.last_message_at == message.created_at


# --------------------------------------------------------------------------- #
# Mocked crypto
# --------------------------------------------------------------------------- #


def test_safety_number_is_symmetric_and_well_formed() -> None:
    """Both sides must derive the same value, or comparing it would be pointless."""
    key_a = mock_crypto.generate_identity_key()
    key_b = mock_crypto.generate_identity_key()

    from_a = mock_crypto.derive_safety_number(key_a, key_b)
    from_b = mock_crypto.derive_safety_number(key_b, key_a)

    assert from_a == from_b
    assert len(from_a) == 60
    assert from_a.isdigit()
    assert len(mock_crypto.format_safety_number(from_a)) == 12


def test_different_pairs_get_different_safety_numbers() -> None:
    key_a = mock_crypto.generate_identity_key()
    key_b = mock_crypto.generate_identity_key()
    key_c = mock_crypto.generate_identity_key()

    assert mock_crypto.derive_safety_number(key_a, key_b) != mock_crypto.derive_safety_number(
        key_a, key_c
    )
