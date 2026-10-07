"""Signal's twelve conversation colors, used for generated avatars.

Values are taken verbatim from ``$conversation-colors`` in Signal-Desktop's
``stylesheets/_variables.scss``. The frontend holds the same list in
``src/lib/colors.ts``; keep the two in sync.
"""

from __future__ import annotations

import hashlib

CONVERSATION_COLORS: dict[str, str] = {
    "crimson": "#cf163e",
    "vermilion": "#c73f0a",
    "burlap": "#6f6a58",
    "forest": "#3b7845",
    "wintergreen": "#1d8663",
    "teal": "#077d92",
    "blue": "#336ba3",
    "indigo": "#6058ca",
    "violet": "#9932c8",
    "plum": "#aa377a",
    "taupe": "#8f616a",
    "steel": "#71717f",
}

COLOR_NAMES: list[str] = list(CONVERSATION_COLORS)


def color_for(key: str) -> str:
    """Deterministically pick a color name for a user or conversation id.

    Hashing rather than random choice means an avatar keeps its color across
    reseeds and across the two services.
    """
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    return COLOR_NAMES[digest[0] % len(COLOR_NAMES)]


def initials(display_name: str) -> str:
    """First letters of the first and last word, as Signal renders them."""
    parts = [part for part in display_name.strip().split() if part]
    if not parts:
        return "#"
    if len(parts) == 1:
        return parts[0][0].upper()
    return (parts[0][0] + parts[-1][0]).upper()
