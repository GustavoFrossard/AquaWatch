import json
import logging
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.cloudinary_service import upload_base64_image
from app.database import get_db
from app.db_models import ObservationRow, UserRow
from app.models import (
    CreateObservationRequest,
    ObservationListResponse,
    ObservationResponse,
    ObservationStatsResponse,
    PublicUser,
)
from app.store import get_user_badges

router = APIRouter(prefix="/api/observations", tags=["observations"])

_log = logging.getLogger("observations")


# ── Gamification constants (mirrors Front/client/lib/gamification.js) ──

POINTS_PER_OBS = 50

BADGE_THRESHOLDS = [
    (1, "primeiro_peixe"),
    (10, "explorador_iniciante"),
    (25, "observador_dedicado"),
    (50, "especialista_marinho"),
    (100, "mestre_oceanos"),
]


def _compute_level(obs_count: int) -> int:
    if obs_count < 10:
        return 1
    if obs_count < 25:
        return 2
    if obs_count < 50:
        return 3
    if obs_count < 75:
        return 4
    if obs_count < 100:
        return 5
    return 6 + (obs_count - 100) // 25


def _compute_badges(obs_count: int) -> list[str]:
    return [badge_id for threshold, badge_id in BADGE_THRESHOLDS if obs_count >= threshold]


def _update_user_gamification(user: UserRow, obs_count: int, db: Session) -> list[str]:
    """Recalculate and persist user gamification. Returns newly unlocked badge ids."""
    old_badges = set(get_user_badges(user))

    user.points = obs_count * POINTS_PER_OBS
    user.level = _compute_level(obs_count)
    new_badges = _compute_badges(obs_count)
    user.badges = json.dumps(new_badges)

    db.commit()

    return [b for b in new_badges if b not in old_badges]


def _row_to_response(row: ObservationRow) -> ObservationResponse:
    return ObservationResponse(
        id=row.id,
        userId=row.user_id,
        nomeCientifico=row.scientific_name,
        nomeComum=row.common_name,
        descricao=row.description,
        tamanho=row.size,
        habitat=row.habitat,
        alimentacao=row.diet,
        conservacao=row.conservation,
        conservacao_detalhe=row.conservation_detail,
        curiosidade=row.fun_fact,
        confianca=row.confidence,
        latitude=row.latitude,
        longitude=row.longitude,
        location=row.location,
        date=row.date_observed,
        time=row.time_observed,
        notes=row.notes,
        image=row.image_url,
        type=row.obs_type,
        species=row.common_name or row.scientific_name or "Espécie desconhecida",
        confidence=row.confidence or "Não avaliado",
        timestamp=int(row.created_at.replace(tzinfo=timezone.utc).timestamp() * 1000) if row.created_at else 0,
    )


def _to_public_user(user: UserRow) -> PublicUser:
    return PublicUser(
        id=user.id,
        username=user.username,
        email=user.email,
        points=user.points,
        level=user.level,
        badges=get_user_badges(user),
    )


# ── Endpoints ──

@router.post("", status_code=status.HTTP_201_CREATED)
def create_observation(
    payload: CreateObservationRequest,
    user_id: str = Depends(require_auth),
    db: Session = Depends(get_db),
):
    user = db.query(UserRow).filter(UserRow.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    # Upload image to Cloudinary (if provided)
    image_url = ""
    if payload.image:
        try:
            image_url = upload_base64_image(payload.image)
        except Exception as exc:
            _log.error("Cloudinary upload failed for user %s: %s", user_id, exc)
            # Save observation without image rather than failing entirely
            image_url = ""

    observation = ObservationRow(
        user_id=user_id,
        scientific_name=payload.nomeCientifico,
        common_name=payload.nomeComum,
        description=payload.descricao,
        size=payload.tamanho,
        habitat=payload.habitat,
        diet=payload.alimentacao,
        conservation=payload.conservacao,
        conservation_detail=payload.conservacao_detalhe,
        fun_fact=payload.curiosidade,
        confidence=payload.confianca,
        latitude=payload.latitude,
        longitude=payload.longitude,
        location=payload.location,
        date_observed=payload.date,
        time_observed=payload.time,
        notes=payload.notes,
        image_url=image_url,
        obs_type="Observação",
    )
    db.add(observation)
    db.commit()
    db.refresh(observation)

    # Gamification: count observations and update user
    obs_count = db.query(func.count(ObservationRow.id)).filter(ObservationRow.user_id == user_id).scalar()
    new_badges = _update_user_gamification(user, obs_count, db)

    return {
        "observation": _row_to_response(observation),
        "user": _to_public_user(user),
        "newBadges": new_badges,
    }


@router.get("", response_model=ObservationListResponse)
def list_observations(
    user_id: str = Depends(require_auth),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(ObservationRow)
        .filter(ObservationRow.user_id == user_id)
        .order_by(ObservationRow.created_at.desc())
        .all()
    )
    return ObservationListResponse(
        observations=[_row_to_response(r) for r in rows],
        total=len(rows),
    )


@router.get("/stats", response_model=ObservationStatsResponse)
def observation_stats(
    user_id: str = Depends(require_auth),
    db: Session = Depends(get_db),
):
    total = db.query(func.count(ObservationRow.id)).filter(ObservationRow.user_id == user_id).scalar()
    unique = (
        db.query(func.count(func.distinct(ObservationRow.scientific_name)))
        .filter(ObservationRow.user_id == user_id, ObservationRow.scientific_name != "")
        .scalar()
    )
    return ObservationStatsResponse(total=total or 0, uniqueSpecies=unique or 0)


@router.delete("/{observation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_observation(
    observation_id: str,
    user_id: str = Depends(require_auth),
    db: Session = Depends(get_db),
):
    obs = db.query(ObservationRow).filter(
        ObservationRow.id == observation_id,
        ObservationRow.user_id == user_id,
    ).first()
    if not obs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Observation not found")

    db.delete(obs)
    db.commit()

    # Recalculate gamification
    obs_count = db.query(func.count(ObservationRow.id)).filter(ObservationRow.user_id == user_id).scalar()
    user = db.query(UserRow).filter(UserRow.id == user_id).first()
    _update_user_gamification(user, obs_count, db)
