"""Owner-token gate: uploads/writes require it; reads never do."""

import secrets

from fastapi import Header, HTTPException

from app.config import get_settings


async def require_owner(x_owner_token: str = Header(default="")) -> None:
    expected = get_settings().owner_token
    if not expected:
        raise HTTPException(503, "Owner access is not configured on this server.")
    if not secrets.compare_digest(x_owner_token, expected):
        raise HTTPException(401, "Owner token required.")
