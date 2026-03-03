from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from app.config import settings
from app.routes.auth import router as auth_router
from app.routes.obis import router as obis_router
from app.store import ensure_admin_user

app = FastAPI(title="AquaWatch Auth API", version="1.0.0")

ensure_admin_user(
    username=settings.admin_username,
    email=settings.admin_email,
    password=settings.admin_password,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.get("/api/ping")
def ping():
    return {"message": "pong"}


app.include_router(auth_router)
app.include_router(obis_router)
