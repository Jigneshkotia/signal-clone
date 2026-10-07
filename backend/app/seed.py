"""Demo data.

Run directly to (re)seed:

    python -m app.seed            # only if the database is empty
    python -m app.seed --reset    # drop everything and rebuild

The goal is an app that is immediately usable on first load: several
conversations with real back-and-forth, a couple of groups, unread badges,
reactions, replies, and a mix of message statuses.
"""

from __future__ import annotations

import argparse
import logging
from datetime import datetime, timedelta

from sqlalchemy import func, select

from app.core import colors, mock_crypto, security
from app.core.mock_crypto import mock_encrypt
from app.database import Base, SessionLocal, create_all, engine
from app.models import (
    Contact,
    Conversation,
    ConversationMember,
    ConversationType,
    MemberRole,
    Message,
    MessageReceipt,
    MessageStatus,
    MessageType,
    Reaction,
    User,
    utcnow,
)

logger = logging.getLogger(__name__)

DEMO_PASSWORD = "signal123"

# key -> (display name, phone, username, about)
PEOPLE: dict[str, tuple[str, str, str, str]] = {
    "jignesh": (
        "Jignesh Kotia",
        "+15550100001",
        "jignesh",
        "Building things \U0001f6e0️",
    ),
    "aisha": ("Aisha Raman", "+15550100002", "aisha", "Design @ Northwind"),
    "daniel": ("Daniel Osei", "+15550100003", "daniel", "Coffee, then code"),
    "mira": ("Mira Kapoor", "+15550100004", "mira", "Out climbing \U0001f9d7"),
    "tomas": ("Tomás Herrera", "+15550100005", "tomas", "Berlin → Lisbon"),
    "lena": ("Lena Fischer", "+15550100006", "lena", "PM. Lover of lists."),
    "yusuf": ("Yusuf Demir", "+15550100007", "yusuf", "Backend gremlin"),
    "priya": ("Priya Nair", "+15550100008", "priya", "\U0001f3a7 always"),
}

# The account the README tells reviewers to log in as.
PRIMARY = "jignesh"

MINUTE = 1
HOUR = 60
DAY = 24 * HOUR


class Thread:
    """One seeded conversation.

    ``messages`` are ``(sender_key, body, minutes_ago)`` and must be ordered
    newest-last. ``unread_for`` lists members who have *not* read the tail, which
    is what produces an unread badge in the chat list.
    """

    def __init__(
        self,
        *,
        kind: ConversationType,
        participants: list[str],
        messages: list[tuple[str | None, str, int]],
        name: str | None = None,
        description: str | None = None,
        admins: list[str] | None = None,
        unread_for: list[str] | None = None,
        reactions: list[tuple[int, str, str]] | None = None,
        replies: dict[int, int] | None = None,
    ) -> None:
        self.kind = kind
        self.participants = participants
        self.messages = messages
        self.name = name
        self.description = description
        self.admins = admins or []
        self.unread_for = unread_for or []
        # (message index, reactor key, emoji)
        self.reactions = reactions or []
        # message index -> index of the message it replies to
        self.replies = replies or {}


THREADS: list[Thread] = [
    Thread(
        kind=ConversationType.DIRECT,
        participants=["jignesh", "aisha"],
        messages=[
            ("aisha", "Morning! Did you get a chance to look at the new mockups?", 2 * DAY + 3 * HOUR),
            ("jignesh", "Just opened them. The spacing on the settings panel looks much better.", 2 * DAY + 2 * HOUR + 40 * MINUTE),
            ("aisha", "That was the main fix. I tightened the row height to 44px.", 2 * DAY + 2 * HOUR + 35 * MINUTE),
            ("jignesh", "Noticeable difference. One thing — the avatar on the group row still feels a touch small.", 2 * DAY + 2 * HOUR + 20 * MINUTE),
            ("aisha", "Fair. I'll bump it to 48 and re-export tonight.", 2 * DAY + 2 * HOUR),
            ("jignesh", "Perfect, thank you \U0001f64f", 2 * DAY + HOUR + 55 * MINUTE),
            ("aisha", "Done — pushed a new set just now. Also fixed the dark mode contrast on the composer.", 5 * HOUR),
            ("jignesh", "You're fast. Looking now.", 4 * HOUR + 50 * MINUTE),
            ("jignesh", "Dark mode is a huge improvement. Ship it.", 4 * HOUR + 30 * MINUTE),
            ("aisha", "\U0001f389 I'll put it up for review this afternoon.", 4 * HOUR + 10 * MINUTE),
        ],
        reactions=[(8, "aisha", "❤️"), (9, "jignesh", "\U0001f44d")],
        replies={3: 2, 7: 6},
    ),
    Thread(
        kind=ConversationType.DIRECT,
        participants=["jignesh", "daniel"],
        messages=[
            ("daniel", "Are we still on for the standup at 10?", DAY + 6 * HOUR),
            ("jignesh", "Yes — I'll send the link ten minutes before.", DAY + 5 * HOUR + 50 * MINUTE),
            ("daniel", "Great. I have the migration notes ready to walk through.", DAY + 5 * HOUR + 45 * MINUTE),
            ("jignesh", "Nice. Were the numbers as bad as you expected?", DAY + 4 * HOUR),
            ("daniel", "Worse. One query was doing a full scan on every chat list load.", DAY + 3 * HOUR + 40 * MINUTE),
            ("jignesh", "The conversation ordering one?", DAY + 3 * HOUR + 30 * MINUTE),
            ("daniel", "That's the one. Denormalising last_message_at fixed it outright.", DAY + 3 * HOUR + 20 * MINUTE),
            ("jignesh", "Worth the extra column then.", DAY + 3 * HOUR),
            ("daniel", "Comfortably. It turns a correlated subquery into an indexed sort.", DAY + 2 * HOUR + 50 * MINUTE),
            ("daniel", "Also: the staging database is back up. That index was the problem.", 2 * HOUR + 20 * MINUTE),
            ("daniel", "Query went from 2.4s to 40ms \U0001f680", 2 * HOUR + 18 * MINUTE),
            ("daniel", "Let me know when you want to pair on the rest of them.", 2 * HOUR + 15 * MINUTE),
        ],
        # The tail is unread, so this chat shows a badge of 3.
        unread_for=["jignesh"],
    ),
    Thread(
        kind=ConversationType.DIRECT,
        participants=["jignesh", "mira"],
        messages=[
            ("mira", "Sent you the photos from the weekend!", 4 * DAY),
            ("jignesh", "The one from the summit is unreal. What time did you start?", 4 * DAY - 30 * MINUTE),
            ("mira", "4am. Brutal but worth it for that light.", 4 * DAY - 45 * MINUTE),
            ("jignesh", "Next time I'm coming. Genuinely.", 3 * DAY - 2 * HOUR),
            ("mira", "I'm holding you to that \U0001f9d7", 3 * DAY - 2 * HOUR - 20 * MINUTE),
            ("jignesh", "What's the training like? I'd need a few months.", 3 * DAY - 3 * HOUR),
            ("mira", "Mostly stairs and patience, honestly.", 3 * DAY - 3 * HOUR - 15 * MINUTE),
            ("mira", "Start with long walks and build from there. The altitude is the hard part.", 3 * DAY - 3 * HOUR - 18 * MINUTE),
            ("jignesh", "Noted. I'll start with the stairs at the office.", 3 * DAY - 4 * HOUR),
            ("mira", "Everyone starts somewhere \U0001f60c", 3 * DAY - 4 * HOUR - 10 * MINUTE),
        ],
        reactions=[(2, "jignesh", "\U0001f525"), (8, "jignesh", "\U0001f602")],
        replies={5: 4},
    ),
    Thread(
        kind=ConversationType.DIRECT,
        participants=["jignesh", "lena"],
        messages=[
            ("lena", "Can you review the roadmap doc before Thursday?", 8 * DAY),
            ("jignesh", "Sure. Anything specific you want eyes on?", 8 * DAY - 40 * MINUTE),
            ("lena", "Mostly Q3 — I think we've committed to one thing too many.", 8 * DAY - HOUR),
            ("jignesh", "I had the same feeling. Let's cut the analytics piece.", 7 * DAY),
            ("lena", "Agreed. I'll redraft and reshare.", 7 * DAY - 30 * MINUTE),
            ("lena", "New version is up whenever you have a moment \U0001f4c4", 45 * MINUTE),
        ],
        unread_for=["jignesh"],
    ),
    Thread(
        kind=ConversationType.DIRECT,
        participants=["jignesh", "tomas"],
        messages=[
            ("tomas", "Landed in Lisbon. The move is finally done.", 11 * DAY),
            ("jignesh", "Congratulations! How's the new place?", 11 * DAY - 2 * HOUR),
            ("tomas", "Small, but there's a balcony and the light is incredible.", 11 * DAY - 3 * HOUR),
            ("jignesh", "That's all you need. Send pictures when you've unpacked.", 10 * DAY),
            ("tomas", "Will do. Come visit — seriously.", 10 * DAY - HOUR),
            ("jignesh", "I might take you up on that in the spring.", 10 * DAY - 2 * HOUR),
            ("tomas", "Spring is the right call. It gets unreasonably hot in August.", 10 * DAY - 3 * HOUR),
            ("tomas", "How's the project going, by the way?", 9 * DAY - 5 * HOUR),
            ("jignesh", "Deep in it. Rebuilding the messaging layer from scratch.", 9 * DAY - 6 * HOUR),
            ("tomas", "That sounds either very fun or very painful.", 9 * DAY - 6 * HOUR - 20 * MINUTE),
            ("jignesh", "Both, usually in the same afternoon.", 9 * DAY - 6 * HOUR - 35 * MINUTE),
        ],
        reactions=[(9, "jignesh", "\U0001f602")],
    ),
    Thread(
        kind=ConversationType.DIRECT,
        participants=["jignesh", "yusuf"],
        messages=[
            ("yusuf", "Quick one — are we storing receipts per recipient or per message?", 5 * DAY),
            ("jignesh", "Per recipient. One row per (message, user).", 5 * DAY - 15 * MINUTE),
            ("yusuf", "Good. That's the only way the group ticks can be right.", 5 * DAY - 25 * MINUTE),
            ("jignesh", "Exactly the reason. A single column can't express “everyone has read it”.", 5 * DAY - 30 * MINUTE),
            ("yusuf", "And you cache the rollup on the message?", 5 * DAY - 40 * MINUTE),
            ("jignesh", "Yes — derived from the receipts, stored so the chat list stays cheap.", 5 * DAY - 45 * MINUTE),
            ("yusuf", "Clean. I'd have done the same.", 5 * DAY - 50 * MINUTE),
            ("yusuf", "What about typing indicators, are those persisted?", 4 * DAY - 2 * HOUR),
            ("jignesh", "No — purely ephemeral, broadcast over the socket and never written down.", 4 * DAY - 2 * HOUR - 10 * MINUTE),
            ("yusuf", "Right, there'd be no point. They're stale the moment they land.", 4 * DAY - 2 * HOUR - 18 * MINUTE),
        ],
        reactions=[(5, "yusuf", "\U0001f4af"), (3, "yusuf", "\U0001f44d")],
        replies={3: 2, 8: 7},
    ),
    Thread(
        kind=ConversationType.DIRECT,
        participants=["jignesh", "priya"],
        messages=[
            ("priya", "The empty states are inconsistent across the app — want me to take a pass?", 6 * DAY),
            ("jignesh", "Please. The chat list one especially.", 6 * DAY - 30 * MINUTE),
            ("priya", "Will do. I'll keep the copy short and skip illustrations.", 6 * DAY - 45 * MINUTE),
            ("jignesh", "Agreed, illustrations would feel off for this product.", 6 * DAY - HOUR),
            ("priya", "That's my instinct too. Privacy tools shouldn't be chirpy.", 6 * DAY - 70 * MINUTE),
            ("priya", "Draft is ready whenever you want to look.", 2 * DAY - 3 * HOUR),
            ("jignesh", "Looking tomorrow morning — thank you.", 2 * DAY - 4 * HOUR),
        ],
        reactions=[(4, "jignesh", "\U0001f4af")],
    ),
    Thread(
        kind=ConversationType.DIRECT,
        participants=["aisha", "lena"],
        messages=[
            ("lena", "Are the icon specs final? I want to lock the Thursday agenda.", 4 * DAY),
            ("aisha", "Final. 24px grid, 1.75 stroke, no filled variants.", 4 * DAY - 25 * MINUTE),
            ("lena", "Perfect. Adding it as the first item.", 4 * DAY - 40 * MINUTE),
        ],
    ),
    # Deliberately excludes the primary user: proves the data model is not
    # centred on one account.
    Thread(
        kind=ConversationType.DIRECT,
        participants=["aisha", "daniel"],
        messages=[
            ("aisha", "Do you have the API contract for the receipts endpoint?", 3 * DAY),
            ("daniel", "Sending now. It's the per-recipient shape we discussed.", 3 * DAY - 20 * MINUTE),
            ("aisha", "Perfect, that's what the UI needs for the group ticks.", 3 * DAY - 35 * MINUTE),
        ],
    ),
    Thread(
        kind=ConversationType.GROUP,
        name="Weekend Trip \U0001f3d4️",
        description="Cabin booked for the 14th–16th. Bring layers.",
        participants=["jignesh", "aisha", "daniel", "mira"],
        admins=["jignesh"],
        messages=[
            ("mira", "Cabin is booked! Three nights, sleeps six.", 6 * DAY),
            ("jignesh", "Amazing work. What's the damage per person?", 6 * DAY - 25 * MINUTE),
            ("mira", "About 85 each including the cleaning fee.", 6 * DAY - 40 * MINUTE),
            ("daniel", "Very reasonable. I'll send mine over tonight.", 6 * DAY - HOUR),
            ("aisha", "Same. Is there a kitchen or are we eating out?", 6 * DAY - 2 * HOUR),
            ("mira", "Full kitchen. I vote we cook at least two of the nights.", 5 * DAY),
            ("jignesh", "I'll handle Saturday dinner if someone takes Friday.", 5 * DAY - 30 * MINUTE),
            ("daniel", "Friday is mine. Doing the pasta thing again.", 5 * DAY - 45 * MINUTE),
            ("aisha", "The pasta thing is non-negotiable at this point \U0001f35d", 5 * DAY - HOUR),
            ("mira", "Settled then. I'll put a packing list together.", 3 * DAY - 4 * HOUR),
            ("aisha", "Please put “actual walking boots” on it in bold.", 3 * DAY - 5 * HOUR),
            ("daniel", "That is pointed and I am choosing to ignore it.", 3 * DAY - 5 * HOUR - 15 * MINUTE),
            ("mira", "Bolded. Underlined, actually.", 3 * DAY - 5 * HOUR - 25 * MINUTE),
            ("jignesh", "Is there any phone signal up there, or are we properly off-grid?", 2 * DAY - 3 * HOUR),
            ("mira", "Patchy. There's wifi at the cabin but it's slow.", 2 * DAY - 3 * HOUR - 20 * MINUTE),
            ("aisha", "Honestly that might be the best part.", 2 * DAY - 3 * HOUR - 30 * MINUTE),
            ("daniel", "Agreed. Two days without a notification sounds restorative.", 2 * DAY - 3 * HOUR - 40 * MINUTE),
            ("jignesh", "One more thing — is anyone driving through the city? I could use a lift.", 6 * HOUR),
            ("daniel", "I am. I'll grab you around 7.", 5 * HOUR + 30 * MINUTE),
        ],
        reactions=[
            (0, "jignesh", "\U0001f389"),
            (0, "aisha", "\U0001f389"),
            (0, "daniel", "\U0001f44d"),
            (8, "mira", "\U0001f602"),
            (11, "mira", "\U0001f602"),
            (18, "jignesh", "\U0001f64f"),
        ],
        replies={6: 5, 10: 9, 18: 17},
    ),
    Thread(
        kind=ConversationType.GROUP,
        name="Design Team",
        description="Weekly sync Thursdays, 11:00.",
        participants=["aisha", "jignesh", "lena", "yusuf", "priya"],
        admins=["aisha", "lena"],
        messages=[
            ("aisha", "Agenda for Thursday is up. Two things: the new icon set and dark mode.", 9 * DAY),
            ("yusuf", "I'll have the token refactor merged before then.", 9 * DAY - 90 * MINUTE),
            ("priya", "Can we also talk about the empty states? They're inconsistent.", 9 * DAY - 2 * HOUR),
            ("aisha", "Yes — adding it. Good catch.", 9 * DAY - 2 * HOUR - 20 * MINUTE),
            ("lena", "I'd like fifteen minutes for the Q3 roadmap if there's room.", 8 * DAY),
            ("aisha", "There is. You're on after the icons.", 8 * DAY - 45 * MINUTE),
            ("jignesh", "I'll bring the implementation notes for the token refactor.", 7 * DAY),
            ("yusuf", "Appreciated. The naming is the part I want to settle.", 7 * DAY - 30 * MINUTE),
            ("priya", "Strong preference for semantic names over literal ones.", 7 * DAY - 50 * MINUTE),
            ("jignesh", "Agreed — surface/label over gray-80.", 7 * DAY - HOUR),
            ("aisha", "That's the direction. Let's lock it Thursday.", 2 * DAY),
            ("lena", "Reminder: Thursday 11:00, same link \U0001f4c5", 26 * HOUR),
        ],
        reactions=[(9, "yusuf", "\U0001f4af"), (9, "aisha", "\U0001f44d"), (2, "aisha", "\U0001f440")],
        replies={9: 8, 3: 2},
    ),
    Thread(
        kind=ConversationType.GROUP,
        name="Launch Week",
        description="Everything shipping on the 21st.",
        participants=["jignesh", "lena", "daniel", "yusuf", "priya"],
        admins=["lena"],
        messages=[
            ("lena", "Kicking this off. The 21st is the date, and it is not moving.", 7 * DAY),
            ("daniel", "Backend is ready. Migrations ran clean on staging last night.", 7 * DAY - 40 * MINUTE),
            ("yusuf", "Same for the socket layer. Reconnect handling is in.", 7 * DAY - 55 * MINUTE),
            ("priya", "Copy is done except the onboarding screens.", 7 * DAY - 70 * MINUTE),
            ("jignesh", "I can help with onboarding copy if it's blocking.", 7 * DAY - 85 * MINUTE),
            ("priya", "It's not blocking yet. I'll shout on Wednesday if it is.", 7 * DAY - 95 * MINUTE),
            ("lena", "Good. What's the story on the group receipts?", 6 * DAY - 2 * HOUR),
            ("daniel", "Working. Double check only fills once every member has read.", 6 * DAY - 2 * HOUR - 15 * MINUTE),
            ("lena", "That's the behaviour we wanted. Nice.", 6 * DAY - 2 * HOUR - 25 * MINUTE),
            ("yusuf", "One caveat — presence resets if the server restarts.", 5 * DAY - 4 * HOUR),
            ("jignesh", "That's deliberate. We clear stale online flags on boot.", 5 * DAY - 4 * HOUR - 12 * MINUTE),
            ("yusuf", "Makes sense. Better than trusting rows from a crashed process.", 5 * DAY - 4 * HOUR - 20 * MINUTE),
            ("lena", "Let's do a full run-through Friday morning.", 3 * DAY),
            ("daniel", "I'll have staging seeded with realistic data by then.", 3 * DAY - 30 * MINUTE),
            ("priya", "Can we include dark mode in the run-through?", 3 * DAY - 45 * MINUTE),
            ("lena", "Yes. Both themes, desktop and mobile widths.", 3 * DAY - 55 * MINUTE),
            ("jignesh", "Responsive is done — single pane under 768px with back navigation.", 2 * DAY - 6 * HOUR),
            ("lena", "Then we're in good shape. Friday, 10:00.", DAY - 3 * HOUR),
        ],
        reactions=[
            (1, "lena", "\U0001f389"),
            (8, "daniel", "\U0001f44d"),
            (11, "jignesh", "\U0001f44d"),
            (17, "priya", "\U0001f389"),
            (17, "yusuf", "\U0001f389"),
        ],
        replies={7: 6, 10: 9, 15: 14},
    ),
]


def _build_users(db) -> dict[str, User]:
    password_hash = security.hash_password(DEMO_PASSWORD)
    users: dict[str, User] = {}

    for key, (display_name, phone, username, about) in PEOPLE.items():
        user = User(
            display_name=display_name,
            phone_number=phone,
            username=username,
            about=about,
            password_hash=password_hash,
            identity_key=mock_crypto.generate_identity_key(),
            # A handful are left online so presence dots are visible immediately.
            is_online=key in {"aisha", "daniel"},
            last_seen_at=utcnow() - timedelta(minutes={"mira": 12, "lena": 90}.get(key, 5)),
        )
        db.add(user)
        db.flush()
        user.avatar_color = colors.color_for(user.id)
        users[key] = user

    # The primary account has everyone else in its address book, and a nickname
    # on one of them to exercise the override path.
    primary = users[PRIMARY]
    for key, user in users.items():
        if key == PRIMARY:
            continue
        db.add(
            Contact(
                owner_id=primary.id,
                contact_user_id=user.id,
                nickname="Tom" if key == "tomas" else None,
            )
        )
        # Reciprocal entry, so the other accounts are usable too.
        db.add(Contact(owner_id=user.id, contact_user_id=primary.id))

    db.commit()
    return users


def _build_thread(db, thread: Thread, users: dict[str, User], now: datetime) -> None:
    conversation = Conversation(
        type=thread.kind,
        name=thread.name,
        description=thread.description,
        created_by=users[thread.participants[0]].id,
    )
    db.add(conversation)
    db.flush()
    conversation.avatar_color = (
        colors.color_for(conversation.id)
        if thread.kind == ConversationType.GROUP
        else users[thread.participants[-1]].avatar_color
    )

    oldest = max((minutes for _, _, minutes in thread.messages), default=0)
    for key in thread.participants:
        db.add(
            ConversationMember(
                conversation_id=conversation.id,
                user_id=users[key].id,
                # Roles only mean something in groups; direct members are peers.
                role=(
                    MemberRole.ADMIN
                    if thread.kind == ConversationType.GROUP and key in thread.admins
                    else MemberRole.MEMBER
                ),
                joined_at=now - timedelta(minutes=oldest + DAY),
            )
        )
    db.flush()

    # Pass 1: persist the messages so reply targets have ids to point at.
    rows: list[Message] = []
    for index, (sender_key, body, minutes_ago) in enumerate(thread.messages):
        created = now - timedelta(minutes=minutes_ago)
        message = Message(
            conversation_id=conversation.id,
            sender_id=users[sender_key].id if sender_key else None,
            body=mock_encrypt(body),
            type=MessageType.TEXT if sender_key else MessageType.SYSTEM,
            created_at=created,
            status=MessageStatus.SENT,
        )
        db.add(message)
        rows.append(message)
    db.flush()

    # Pass 2: wire up quoted replies.
    for child_index, parent_index in thread.replies.items():
        if child_index < len(rows) and parent_index < len(rows):
            rows[child_index].reply_to_id = rows[parent_index].id

    # Pass 3: receipts. Everything is read except the tail of a thread marked
    # unread for someone, which is what produces the badge and the tick states.
    unread_ids = {users[key].id for key in thread.unread_for}
    member_ids = [users[key].id for key in thread.participants]

    last_read_at: dict[str, datetime | None] = {uid: None for uid in member_ids}

    for message in rows:
        if message.sender_id is None:
            continue
        for member_id in member_ids:
            if member_id == message.sender_id:
                last_read_at[member_id] = message.created_at
                continue

            is_unread = member_id in unread_ids and message.created_at > now - timedelta(
                hours=3
            )
            receipt = MessageReceipt(
                message_id=message.id,
                user_id=member_id,
                delivered_at=message.created_at + timedelta(seconds=2),
                read_at=None if is_unread else message.created_at + timedelta(minutes=1),
            )
            db.add(receipt)
            if not is_unread:
                last_read_at[member_id] = message.created_at

    db.flush()

    # Pass 4: reactions.
    for message_index, reactor_key, emoji in thread.reactions:
        if message_index >= len(rows):
            continue
        db.add(
            Reaction(
                message_id=rows[message_index].id,
                user_id=users[reactor_key].id,
                emoji=emoji,
                created_at=rows[message_index].created_at + timedelta(minutes=2),
            )
        )

    # Cache each message's aggregate status now that receipts exist.
    from app.services.message_service import derive_status

    for message in rows:
        db.refresh(message)
        message.status = derive_status(message)

    # Watermarks and the denormalised sort key.
    for member in db.scalars(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conversation.id
        )
    ):
        member.last_read_at = last_read_at.get(member.user_id)

    conversation.last_message_at = rows[-1].created_at if rows else None
    conversation.created_at = now - timedelta(minutes=oldest + DAY)
    conversation.updated_at = conversation.last_message_at or conversation.created_at

    db.commit()


def seed(reset: bool = False) -> None:
    """Build the full demo dataset."""
    if reset:
        logger.info("Dropping all tables")
        Base.metadata.drop_all(bind=engine)

    create_all()

    now = utcnow()
    with SessionLocal() as db:
        users = _build_users(db)
        for thread in THREADS:
            _build_thread(db, thread, users, now)

        message_count = db.scalar(select(func.count()).select_from(Message)) or 0

    logger.info(
        "Seeded %d users, %d conversations, %d messages",
        len(PEOPLE),
        len(THREADS),
        message_count,
    )


def seed_if_empty() -> bool:
    """Seed only when there are no users. Returns True if seeding ran."""
    create_all()
    with SessionLocal() as db:
        if db.scalars(select(User).limit(1)).first() is not None:
            return False
    seed()
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description="Seed the Signal clone database")
    parser.add_argument(
        "--reset", action="store_true", help="Drop every table before seeding"
    )
    args = parser.parse_args()

    if args.reset:
        seed(reset=True)
    elif seed_if_empty():
        pass
    else:
        print("Database already has users. Use --reset to rebuild from scratch.")
        return

    print(
        "\nSeeded. Log in with any of these (password: "
        f"{DEMO_PASSWORD}):\n"
    )
    for key, (display_name, phone, username, _about) in PEOPLE.items():
        marker = "  <- primary demo account" if key == PRIMARY else ""
        print(f"  {display_name:<16} {phone}  @{username}{marker}")


if __name__ == "__main__":
    main()
