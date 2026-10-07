"""Conversation and membership payloads."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.common import ConversationType, MemberRole
from app.schemas.message import MessageOut
from app.schemas.user import UserPublic


class MemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user: UserPublic
    role: MemberRole
    joined_at: datetime


class ConversationOut(BaseModel):
    """A conversation as seen by one specific caller.

    ``title``, ``unread_count``, ``is_pinned`` and friends are all viewer-relative,
    which is why this is assembled in the service layer rather than read straight
    off the ORM object.
    """

    id: str
    type: ConversationType
    title: str
    description: str | None = None
    avatar_url: str | None = None
    avatar_color: str
    disappear_seconds: int = 0

    members: list[MemberOut] = Field(default_factory=list)
    # For a direct conversation, the person on the other side. None for groups.
    other_user: UserPublic | None = None

    last_message: MessageOut | None = None
    last_message_at: datetime | None = None
    unread_count: int = 0

    is_pinned: bool = False
    is_archived: bool = False
    is_muted: bool = False
    my_role: MemberRole = MemberRole.MEMBER
    created_at: datetime


class DirectConversationCreate(BaseModel):
    user_id: str


class GroupConversationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    member_ids: list[str] = Field(min_length=1)
    description: str | None = Field(default=None, max_length=512)
    avatar_url: str | None = None

    @model_validator(mode="after")
    def _dedupe_members(self) -> "GroupConversationCreate":
        # Preserve order while removing repeats, so the UI's picker order holds.
        self.member_ids = list(dict.fromkeys(self.member_ids))
        return self


class ConversationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=512)
    avatar_url: str | None = None
    disappear_seconds: int | None = Field(default=None, ge=0)


class MemberAdd(BaseModel):
    user_ids: list[str] = Field(min_length=1)


class MemberStateUpdate(BaseModel):
    """Per-member flags: pin, archive, mute. All optional, all viewer-private."""

    is_pinned: bool | None = None
    is_archived: bool | None = None
    muted_until: datetime | None = None
