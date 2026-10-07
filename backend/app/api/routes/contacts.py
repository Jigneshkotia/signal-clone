"""The address book: list and add contacts."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.models import Contact
from app.schemas.user import ContactCreate, ContactOut
from app.services import auth_service

router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.get("", response_model=list[ContactOut])
def list_contacts(current_user: CurrentUser, db: DbSession) -> list[ContactOut]:
    contacts = db.scalars(
        select(Contact).where(Contact.owner_id == current_user.id)
    ).all()
    # Sort by the name the viewer sees, which may be their own nickname for them.
    ordered = sorted(
        contacts, key=lambda c: (c.nickname or c.contact_user.display_name).lower()
    )
    return [ContactOut.model_validate(contact) for contact in ordered]


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
def add_contact(
    payload: ContactCreate, current_user: CurrentUser, db: DbSession
) -> ContactOut:
    """Add someone by phone number or username.

    One-directional: this only writes to the caller's own address book, so being
    added never changes anything for the person added.
    """
    identifier = payload.phone_number or payload.username
    if not identifier:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide a phone number or username",
        )

    target = auth_service.find_by_identifier(db, identifier)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Nobody on Signal matches that",
        )
    if target.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="You cannot add yourself as a contact",
        )

    existing = db.scalars(
        select(Contact).where(
            Contact.owner_id == current_user.id,
            Contact.contact_user_id == target.id,
        )
    ).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{target.display_name} is already in your contacts",
        )

    contact = Contact(
        owner_id=current_user.id,
        contact_user_id=target.id,
        nickname=payload.nickname,
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return ContactOut.model_validate(contact)


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(contact_id: str, current_user: CurrentUser, db: DbSession) -> None:
    contact = db.get(Contact, contact_id)
    if contact is None or contact.owner_id != current_user.id:
        raise HTTPException(status_code=404, detail="Contact not found")
    db.delete(contact)
    db.commit()
