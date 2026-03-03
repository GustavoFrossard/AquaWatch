from fastapi import Cookie, HTTPException, status
from app.config import settings
from app.security import decode_auth_token


def require_auth(auth_token: str | None = Cookie(default=None, alias=settings.auth_cookie_name)) -> str:
    if not auth_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        payload = decode_auth_token(auth_token)
        user_id = payload.get("sub")
        if not user_id:
            raise ValueError("Missing sub in token")
        return user_id
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc
