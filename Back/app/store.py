import json
import uuid

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.db_models import UserRow
from app.security import hash_password


# ── helpers to convert badge list ↔ JSON string ──

def _badges_to_json(badges: list[str]) -> str:
    return json.dumps(badges)


def _badges_from_json(raw: str) -> list[str]:
    try:
        return json.loads(raw) if raw else []
    except (json.JSONDecodeError, TypeError):
        return []


# ── public interface ──

def find_user_by_email(email: str, db: Session) -> UserRow | None:
    return db.query(UserRow).filter(UserRow.email == email.lower()).first()


def find_user_by_id(user_id: str, db: Session) -> UserRow | None:
    return db.query(UserRow).filter(UserRow.id == user_id).first()


def create_user(username: str, email: str, password_hash: str, db: Session) -> UserRow:
    user = UserRow(
        id=str(uuid.uuid4()),
        username=username,
        email=email.lower(),
        password_hash=password_hash,
        points=0,
        level=1,
        badges="[]",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def ensure_admin_user(username: str, email: str, password: str) -> UserRow:
    """Startup-only helper — creates its own session."""
    db = SessionLocal()
    try:
        existing = find_user_by_email(email, db)
        if existing:
            return existing
        return create_user(
            username=username.strip() or "admin",
            email=email,
            password_hash=hash_password(password),
            db=db,
        )
    finally:
        db.close()


def get_user_badges(user: UserRow) -> list[str]:
    return _badges_from_json(user.badges)


def set_user_badges(user: UserRow, badges: list[str], db: Session) -> None:
    user.badges = _badges_to_json(badges)
    db.commit()

