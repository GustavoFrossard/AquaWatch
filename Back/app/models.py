from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=6, max_length=72)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=6, max_length=72)


class PublicUser(BaseModel):
    id: str
    username: str
    email: str
    points: int
    level: int
    badges: list[str]


class AuthResponse(BaseModel):
    user: PublicUser
