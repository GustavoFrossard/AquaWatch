import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def _utcnow():
    return datetime.now(timezone.utc)


class UserRow(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username: Mapped[str] = mapped_column(String(30), nullable=False)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    points: Mapped[int] = mapped_column(Integer, default=0)
    level: Mapped[int] = mapped_column(Integer, default=1)
    badges: Mapped[str] = mapped_column(Text, default="[]")  # JSON string list
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    observations: Mapped[list["ObservationRow"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class ObservationRow(Base):
    __tablename__ = "observations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    scientific_name: Mapped[str] = mapped_column(String(255), default="")
    common_name: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    size: Mapped[str] = mapped_column(String(100), default="")
    habitat: Mapped[str] = mapped_column(Text, default="")
    diet: Mapped[str] = mapped_column(Text, default="")
    conservation: Mapped[str] = mapped_column(String(100), default="")
    conservation_detail: Mapped[str] = mapped_column(Text, default="")
    fun_fact: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[str] = mapped_column(String(30), default="")

    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    location: Mapped[str] = mapped_column(String(255), default="")

    date_observed: Mapped[str] = mapped_column(String(20), default="")
    time_observed: Mapped[str] = mapped_column(String(10), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str] = mapped_column(Text, default="")

    obs_type: Mapped[str] = mapped_column(String(50), default="Observação")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["UserRow"] = relationship(back_populates="observations")
