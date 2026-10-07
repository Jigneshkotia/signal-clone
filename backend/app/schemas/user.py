"""User, contact, and profile payloads."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserPublic(BaseModel):
    """How a user appears to anyone else. Never includes credentials."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    display_name: str
    username: str | None = None
    phone_number: str | None = None
    about: str | None = None
    avatar_url: str | None = None
    avatar_color: str
    is_online: bool
    last_seen_at: datetime | None = None


class UserMe(UserPublic):
    """The authenticated user's own profile, with their identity key."""

    identity_key: str
    created_at: datetime


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=128)
    about: str | None = Field(default=None, max_length=256)
    avatar_url: str | None = None
    avatar_color: str | None = Field(default=None, max_length=24)


class ContactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    nickname: str | None = None
    created_at: datetime
    user: UserPublic = Field(validation_alias="contact_user")


class ContactCreate(BaseModel):
    """Add by phone number or username -- exactly one is required."""

    phone_number: str | None = None
    username: str | None = None
    nickname: str | None = Field(default=None, max_length=128)


class SafetyNumberOut(BaseModel):
    """The mocked pairwise fingerprint, pre-split into Signal's 12 groups."""

    conversation_id: str
    safety_number: str
    groups: list[str]
    verified: bool = False
