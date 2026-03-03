from datetime import datetime, timedelta, timezone
import bcrypt
import jwt
from app.config import settings


def hash_password(raw_password: str) -> str:
    password_bytes = raw_password.encode("utf-8")
    if len(password_bytes) > 72:
        raise ValueError("Password cannot be longer than 72 bytes")

    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode("utf-8")


def verify_password(raw_password: str, password_hash: str) -> bool:
    password_bytes = raw_password.encode("utf-8")
    hash_bytes = password_hash.encode("utf-8")

    if len(password_bytes) > 72:
        return False

    return bcrypt.checkpw(password_bytes, hash_bytes)


def create_auth_token(user_id: str, email: str) -> str:
    expiration = datetime.now(timezone.utc) + timedelta(
        minutes=settings.jwt_expires_minutes
    )
    payload = {
        "sub": user_id,
        "email": email,
        "exp": expiration,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_auth_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
