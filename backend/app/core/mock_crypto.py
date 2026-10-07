"""Simulated end-to-end encryption.

This is deliberately NOT real cryptography. The assignment scopes out the Signal
protocol, so this module reproduces only the parts users can *see*:

* every account gets an identity key at registration;
* any two identity keys derive a stable 60-digit safety number, so both sides of
  a conversation independently compute the same value and can compare it;
* message bodies make a reversible round trip, standing in for encrypt/decrypt.

Message bodies are recoverable plaintext in the database. Nothing here provides
confidentiality and none of it should be copied into a real product.
"""

from __future__ import annotations

import base64
import hashlib
import secrets

# Signal renders a safety number as 12 groups of 5 digits.
SAFETY_NUMBER_GROUPS = 12
SAFETY_NUMBER_GROUP_SIZE = 5
SAFETY_NUMBER_LENGTH = SAFETY_NUMBER_GROUPS * SAFETY_NUMBER_GROUP_SIZE


def generate_identity_key() -> str:
    """A random stand-in for a long-term identity public key."""
    return secrets.token_hex(32)


def derive_safety_number(identity_key_a: str, identity_key_b: str) -> str:
    """Derive the 60-digit fingerprint shared by two identities.

    The inputs are sorted before hashing so both participants compute an
    identical number regardless of who asks -- the property that makes
    out-of-band comparison meaningful in the real protocol.
    """
    first, second = sorted([identity_key_a, identity_key_b])
    digest = hashlib.sha256(f"{first}:{second}".encode()).digest()

    # Expand the digest into decimal digits, reducing 2 bytes at a time so the
    # distribution stays even across all 60 positions.
    digits: list[str] = []
    counter = 0
    while len(digits) < SAFETY_NUMBER_LENGTH:
        block = hashlib.sha256(digest + counter.to_bytes(4, "big")).digest()
        for index in range(0, len(block) - 1, 2):
            if len(digits) >= SAFETY_NUMBER_LENGTH:
                break
            chunk = int.from_bytes(block[index : index + 2], "big")
            digits.append(f"{chunk % 100000:05d}")
        counter += 1

    return "".join(digits)[:SAFETY_NUMBER_LENGTH]


def format_safety_number(safety_number: str) -> list[str]:
    """Split a safety number into the 12 five-digit groups the UI renders."""
    return [
        safety_number[i : i + SAFETY_NUMBER_GROUP_SIZE]
        for i in range(0, len(safety_number), SAFETY_NUMBER_GROUP_SIZE)
    ]


def mock_encrypt(plaintext: str) -> str:
    """Stand-in for sealing a message body. Reversible by design."""
    return base64.b64encode(plaintext.encode("utf-8")).decode("ascii")


def mock_decrypt(ciphertext: str) -> str:
    """Inverse of :func:`mock_encrypt`, tolerant of unencoded legacy values."""
    try:
        return base64.b64decode(ciphertext.encode("ascii"), validate=True).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        # Seeded or hand-written rows may be stored as plain text.
        return ciphertext
