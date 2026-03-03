from dataclasses import dataclass, field
import uuid
from app.security import hash_password


@dataclass
class User:
    id: str
    username: str
    email: str
    password_hash: str
    points: int = 0
    level: int = 1
    badges: list[str] = field(default_factory=list)


users_by_email: dict[str, User] = {}
users_by_id: dict[str, User] = {}


def find_user_by_email(email: str) -> User | None:
    return users_by_email.get(email.lower())


def find_user_by_id(user_id: str) -> User | None:
    return users_by_id.get(user_id)


def create_user(username: str, email: str, password_hash: str) -> User:
    user = User(
        id=str(uuid.uuid4()),
        username=username,
        email=email.lower(),
        password_hash=password_hash,
    )
    users_by_email[user.email] = user
    users_by_id[user.id] = user
    return user


def ensure_admin_user(username: str, email: str, password: str) -> User:
    existing = find_user_by_email(email)
    if existing:
        return existing

    return create_user(
        username=username.strip() or "admin",
        email=email,
        password_hash=hash_password(password),
    )
