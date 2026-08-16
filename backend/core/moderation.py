"""Shared UGC moderation primitives (Apple Guideline 1.2).

Kept small and dependency-free so any feature that accepts user-generated content
(reviews, team chat, …) can enforce the same objectionable-language filter.
"""
import re

from fastapi import HTTPException

# Deliberately conservative substring filter to avoid false positives.
_BANNED = [
    "fuck", "shit", "bitch", "asshole", "cunt", "nigger", "nigga", "faggot",
    "fag", "retard", "whore", "slut", "rape", "dick", "pussy", "cock",
    "kill yourself", "kys",
]
BANNED_RE = re.compile(r"(?i)(" + "|".join(re.escape(w) for w in _BANNED) + r")")

# Distinct reports before content is auto-hidden from everyone.
FLAG_HIDE_THRESHOLD = 3


def assert_clean(*parts: str) -> None:
    for p in parts:
        if p and BANNED_RE.search(p):
            raise HTTPException(
                status_code=400,
                detail="Your message contains language that isn't allowed. Please revise and try again.",
            )
