"""Registration, OTP verification, and login payloads."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.user import UserMe


class RegisterRequest(BaseModel):
    """Either a phone number or a username identifies the new account."""

    phone_number: str | None = Field(default=None, max_length=32)
    username: str | None = Field(default=None, min_length=3, max_length=64)
    display_name: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=6, max_length=72)
    about: str | None = Field(default=None, max_length=256)
    avatar_url: str | None = None

    @field_validator("phone_number")
    @classmethod
    def _normalise_phone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        # Keep digits and a leading +, so "+1 (555) 010-1234" and "+15550101234"
        # resolve to the same account.
        cleaned = value.strip()
        sign = "+" if cleaned.startswith("+") else ""
        digits = "".join(char for char in cleaned if char.isdigit())
        if not digits:
            raise ValueError("Phone number must contain digits")
        return f"{sign}{digits}"

    @field_validator("username")
    @classmethod
    def _normalise_username(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip().lstrip("@").lower()
        if not cleaned.replace("_", "").replace(".", "").isalnum():
            raise ValueError("Username may only contain letters, digits, '.' and '_'")
        return cleaned

    @model_validator(mode="after")
    def _require_an_identifier(self) -> "RegisterRequest":
        if not self.phone_number and not self.username:
            raise ValueError("Provide either a phone number or a username")
        return self


class OtpRequest(BaseModel):
    """Ask for a code. Identifies the destination only -- there is no code yet."""

    phone_number: str | None = None
    username: str | None = None

    @model_validator(mode="after")
    def _require_a_destination(self) -> "OtpRequest":
        if not self.phone_number and not self.username:
            raise ValueError("Provide either a phone number or a username")
        return self


class VerifyOtpRequest(OtpRequest):
    """Mocked verification. The accepted code is fixed in settings."""

    code: str = Field(min_length=4, max_length=8)


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, description="Phone number or username")
    password: str = Field(min_length=1, max_length=72)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserMe


class OtpChallenge(BaseModel):
    """Returned by the mocked OTP step so the UI can show the expected code."""

    sent_to: str
    # Echoed back only because verification is simulated; a real system would
    # never return the code it just issued.
    demo_code: str
    message: str
