"""Registration, mocked OTP verification, login, and session lookup."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, DbSession
from app.config import settings
from app.core.security import create_access_token
from app.schemas.auth import (
    AuthResponse,
    LoginRequest,
    OtpChallenge,
    OtpRequest,
    RegisterRequest,
    VerifyOtpRequest,
)
from app.schemas.user import UserMe
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/request-otp", response_model=OtpChallenge)
def request_otp(payload: OtpRequest) -> OtpChallenge:
    """Pretend to send a verification code.

    Nothing is sent and nothing is stored: the accepted code is fixed in
    settings, and it is echoed back so the UI can prefill it for the demo. A real
    implementation would persist a hashed, expiring, rate-limited challenge.
    """
    destination = payload.phone_number or payload.username or "your device"
    return OtpChallenge(
        sent_to=destination,
        demo_code=settings.mock_otp_code,
        message=f"Verification code sent to {destination}",
    )


@router.post("/verify-otp")
def verify_otp(payload: VerifyOtpRequest) -> dict[str, bool]:
    """Check the mocked code before letting registration proceed."""
    if payload.code != settings.mock_otp_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That code is incorrect",
        )
    return {"verified": True}


@router.post(
    "/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED
)
def register(payload: RegisterRequest, db: DbSession) -> AuthResponse:
    try:
        user = auth_service.register(db, payload)
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    return AuthResponse(
        access_token=create_access_token(user.id),
        user=UserMe.model_validate(user),
    )


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: DbSession) -> AuthResponse:
    try:
        user = auth_service.authenticate(db, payload.identifier, payload.password)
    except auth_service.AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc

    return AuthResponse(
        access_token=create_access_token(user.id),
        user=UserMe.model_validate(user),
    )


@router.post("/logout")
def logout(current_user: CurrentUser) -> dict[str, bool]:
    """Stateless logout.

    JWTs are self-contained, so the server has nothing to revoke -- the client
    discards the token. Kept as an endpoint so the frontend has one place to call
    and so a future token denylist has somewhere to live.
    """
    _ = current_user
    return {"ok": True}


@router.get("/me", response_model=UserMe)
def me(current_user: CurrentUser) -> UserMe:
    return UserMe.model_validate(current_user)
