"""HTTP-level tests: auth, authorisation, and the serialised shapes."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import User
from app.services import conversation_service, message_service


def auth_header(client: TestClient, identifier: str, password: str = "password123") -> dict:
    response = client.post(
        "/api/auth/login", json={"identifier": identifier, "password": password}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_register_login_and_me(client: TestClient) -> None:
    created = client.post(
        "/api/auth/register",
        json={
            "phone_number": "+1 (555) 123-4567",
            "display_name": "New Person",
            "password": "hunter2345",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    # The phone number is normalised on the way in.
    assert body["user"]["phone_number"] == "+15551234567"

    token = body["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["display_name"] == "New Person"

    # Either spelling of the number resolves to the same account.
    for identifier in ("+15551234567", "+1 (555) 123-4567"):
        again = client.post(
            "/api/auth/login", json={"identifier": identifier, "password": "hunter2345"}
        )
        assert again.status_code == 200, identifier


def test_register_requires_an_identifier(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={"display_name": "Nameless", "password": "hunter2345"},
    )
    assert response.status_code == 422


def test_duplicate_phone_number_is_rejected(client: TestClient, alice: User) -> None:
    response = client.post(
        "/api/auth/register",
        json={
            "phone_number": alice.phone_number,
            "display_name": "Impostor",
            "password": "hunter2345",
        },
    )
    assert response.status_code == 409


def test_protected_routes_require_a_token(client: TestClient) -> None:
    assert client.get("/api/conversations").status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    assert (
        client.get(
            "/api/conversations", headers={"Authorization": "Bearer not-a-real-token"}
        ).status_code
        == 401
    )


def test_otp_verification_accepts_only_the_fixed_code(client: TestClient) -> None:
    # Requesting a code needs only a destination -- there is no code to send yet.
    challenge = client.post(
        "/api/auth/request-otp", json={"phone_number": "+15550009999"}
    )
    assert challenge.status_code == 200, challenge.text
    code = challenge.json()["demo_code"]

    assert (
        client.post(
            "/api/auth/verify-otp", json={"phone_number": "+15550009999", "code": code}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/auth/verify-otp", json={"phone_number": "+15550009999", "code": "000000"}
        ).status_code
        == 400
    )


def test_conversation_list_is_scoped_to_the_caller(
    client: TestClient, db: Session, alice: User, bob: User, carol: User
) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)
    message_service.create_message(
        db, conversation=conversation, sender=alice, body="private"
    )

    for user, expected in ((alice, 1), (bob, 1), (carol, 0)):
        response = client.get(
            "/api/conversations", headers=auth_header(client, user.phone_number)
        )
        assert response.status_code == 200
        assert len(response.json()) == expected, user.display_name


def test_non_member_cannot_read_history(
    client: TestClient, db: Session, alice: User, bob: User, carol: User
) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)

    response = client.get(
        f"/api/conversations/{conversation.id}/messages",
        headers=auth_header(client, carol.phone_number),
    )
    assert response.status_code == 404


def test_send_message_over_rest(
    client: TestClient, db: Session, alice: User, bob: User
) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)

    response = client.post(
        f"/api/conversations/{conversation.id}/messages",
        json={"body": "Sent over HTTP", "client_id": "rest-1"},
        headers=auth_header(client, alice.phone_number),
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["body"] == "Sent over HTTP"
    assert payload["status"] == "sent"
    # Timestamps must carry a UTC offset or the browser will read them as local.
    assert payload["created_at"].endswith("Z") or "+00:00" in payload["created_at"]


def test_group_creation_and_member_management_over_rest(
    client: TestClient, alice: User, bob: User, carol: User
) -> None:
    headers = auth_header(client, alice.phone_number)

    created = client.post(
        "/api/conversations/group",
        json={"name": "Weekend", "member_ids": [bob.id]},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    group = created.json()
    assert group["my_role"] == "admin"
    assert len(group["members"]) == 2

    added = client.post(
        f"/api/conversations/{group['id']}/members",
        json={"user_ids": [carol.id]},
        headers=headers,
    )
    assert added.status_code == 200
    assert len(added.json()["members"]) == 3

    # Bob is not an admin, so he cannot remove Carol.
    refused = client.delete(
        f"/api/conversations/{group['id']}/members/{carol.id}",
        headers=auth_header(client, bob.phone_number),
    )
    assert refused.status_code == 403


def test_safety_number_matches_for_both_participants(
    client: TestClient, db: Session, alice: User, bob: User
) -> None:
    conversation, _ = conversation_service.get_or_create_direct(db, alice, bob.id)

    from_alice = client.get(
        f"/api/conversations/{conversation.id}/safety-number",
        headers=auth_header(client, alice.phone_number),
    ).json()
    from_bob = client.get(
        f"/api/conversations/{conversation.id}/safety-number",
        headers=auth_header(client, bob.phone_number),
    ).json()

    assert from_alice["safety_number"] == from_bob["safety_number"]
    assert len(from_alice["groups"]) == 12


def test_contacts_are_one_directional(
    client: TestClient, alice: User, bob: User
) -> None:
    added = client.post(
        "/api/contacts",
        json={"phone_number": bob.phone_number, "nickname": "Bobby"},
        headers=auth_header(client, alice.phone_number),
    )
    assert added.status_code == 201

    # Alice has Bob; Bob does not automatically have Alice.
    assert len(
        client.get("/api/contacts", headers=auth_header(client, alice.phone_number)).json()
    ) == 1
    assert (
        client.get("/api/contacts", headers=auth_header(client, bob.phone_number)).json()
        == []
    )


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
