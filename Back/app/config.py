import os
import secrets
import logging
from dotenv import load_dotenv

load_dotenv()

_log = logging.getLogger("config")


class Settings:
    environment: str = os.getenv("ENVIRONMENT", "development")
    host: str = os.getenv("HOST", "127.0.0.1")
    port: int = int(os.getenv("PORT", "4000"))

    @property
    def is_production(self) -> bool:
        return self.environment.lower() not in ("development", "dev", "local")
    cors_origins: list[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://127.0.0.1:8080,http://localhost:8080,https://aqua-watch-tan.vercel.app,http://localhost:5173",
        ).split(",")
        if origin.strip()
    ]

    # JWT — generate random secret in dev; require env var in production
    _jwt_raw: str = os.getenv("JWT_SECRET", "")
    jwt_secret: str = _jwt_raw or secrets.token_urlsafe(32)
    jwt_expires_minutes: int = int(os.getenv("JWT_EXPIRES_MINUTES", "10080"))
    auth_cookie_name: str = os.getenv("AUTH_COOKIE_NAME", "auth_token")

    admin_username: str = os.getenv("ADMIN_USERNAME", "admin")
    admin_email: str = os.getenv("ADMIN_EMAIL", "admin@aquawatch.com")
    _admin_pw_raw: str = os.getenv("ADMIN_PASSWORD", "")
    admin_password: str = _admin_pw_raw or "admin_dev_" + secrets.token_hex(4)

    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")

    # Neon PostgreSQL
    database_url: str = os.getenv("DATABASE_URL", "")

    # Cloudinary
    cloudinary_cloud_name: str = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    cloudinary_api_key: str = os.getenv("CLOUDINARY_API_KEY", "")
    cloudinary_api_secret: str = os.getenv("CLOUDINARY_API_SECRET", "")

    def validate(self) -> None:
        """Raise on missing critical env vars in production."""
        if self.is_production:
            missing = []
            if not self._jwt_raw:
                missing.append("JWT_SECRET")
            if not self._admin_pw_raw:
                missing.append("ADMIN_PASSWORD")
            if not self.database_url:
                missing.append("DATABASE_URL")
            if missing:
                raise RuntimeError(
                    f"Missing required env vars for production: {', '.join(missing)}"
                )
        else:
            if not self._jwt_raw:
                _log.warning("JWT_SECRET not set — using random secret (sessions won't survive restarts)")
            if not self._admin_pw_raw:
                _log.warning("ADMIN_PASSWORD not set — using generated password: %s", self.admin_password)

        if not self.database_url:
            raise RuntimeError("DATABASE_URL is required. Example: postgresql+psycopg2://user:pass@host/db")


settings = Settings()
settings.validate()
