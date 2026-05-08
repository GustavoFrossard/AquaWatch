from pydantic import BaseModel, Field, field_validator
import re

# 10 MB limit for base64 image strings (~7.5 MB decoded)
MAX_IMAGE_BASE64_LEN = 10 * 1024 * 1024


def _validate_password(v: str) -> str:
    if not re.search(r"[A-Za-z]", v):
        raise ValueError("Password must contain at least one letter")
    if not re.search(r"[0-9]", v):
        raise ValueError("Password must contain at least one digit")
    return v


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=72)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        return _validate_password(v)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=72)


class PublicUser(BaseModel):
    id: str
    username: str
    email: str
    points: int
    level: int
    badges: list[str]


class AuthResponse(BaseModel):
    user: PublicUser


# ── Observations ──

class CreateObservationRequest(BaseModel):
    nomeCientifico: str = ""
    nomeComum: str = ""
    descricao: str = ""
    tamanho: str = ""
    habitat: str = ""
    alimentacao: str = ""
    conservacao: str = ""
    conservacao_detalhe: str = ""
    curiosidade: str = ""
    confianca: str = ""
    latitude: float | None = None
    longitude: float | None = None
    location: str = ""
    date: str = ""
    time: str = ""
    notes: str = ""
    image: str = ""  # base64 data-URI

    @field_validator("image")
    @classmethod
    def check_image_size(cls, v: str) -> str:
        if v and len(v) > MAX_IMAGE_BASE64_LEN:
            raise ValueError(f"Image too large (max {MAX_IMAGE_BASE64_LEN // (1024 * 1024)} MB)")
        return v


class ObservationResponse(BaseModel):
    id: str
    userId: str
    nomeCientifico: str
    nomeComum: str
    descricao: str
    tamanho: str
    habitat: str
    alimentacao: str
    conservacao: str
    conservacao_detalhe: str
    curiosidade: str
    confianca: str
    latitude: float | None
    longitude: float | None
    location: str
    date: str
    time: str
    notes: str
    image: str  # Cloudinary URL
    type: str
    species: str
    confidence: str
    timestamp: int


class ObservationListResponse(BaseModel):
    observations: list[ObservationResponse]
    total: int


class ObservationStatsResponse(BaseModel):
    total: int
    uniqueSpecies: int
