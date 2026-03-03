from fastapi import APIRouter, Depends, HTTPException, Response, status
from app.auth import require_auth
from app.config import settings
from app.models import AuthResponse, LoginRequest, PublicUser, RegisterRequest
from app.security import create_auth_token, hash_password, verify_password
from app.store import create_user, find_user_by_email, find_user_by_id

router = APIRouter(prefix="/api/auth", tags=["auth"])


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email format",
        )
    return email


def to_public_user(user) -> PublicUser:
    return PublicUser(
        id=user.id,
        username=user.username,
        email=user.email,
        points=user.points,
        level=user.level,
        badges=user.badges,
    )


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=settings.jwt_expires_minutes * 60,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.auth_cookie_name,
        httponly=True,
        secure=False,
        samesite="lax",
        path="/",
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, response: Response):
    email = normalize_email(payload.email)

    existing = find_user_by_email(email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use")

    user = create_user(
        username=payload.username.strip(),
        email=email,
        password_hash=hash_password(payload.password),
    )

    token = create_auth_token(user.id, user.email)
    set_auth_cookie(response, token)
    return AuthResponse(user=to_public_user(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, response: Response):
    email = normalize_email(payload.email)
    user = find_user_by_email(email)

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    token = create_auth_token(user.id, user.email)
    set_auth_cookie(response, token)
    return AuthResponse(user=to_public_user(user))


@router.post("/logout")
def logout(response: Response):
    clear_auth_cookie(response)
    return {"message": "Logged out"}


@router.get("/me", response_model=AuthResponse)
def me(user_id: str = Depends(require_auth)):
    user = find_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    return AuthResponse(user=to_public_user(user))
