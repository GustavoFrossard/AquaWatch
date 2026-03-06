import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    host: str = os.getenv("HOST", "127.0.0.1")
    port: int = int(os.getenv("PORT", "4000"))
    cors_origins: list[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://127.0.0.1:8080,http://localhost:8080",
        ).split(",")
        if origin.strip()
    ]
    jwt_secret: str = os.getenv("JWT_SECRET", "change_this_for_production")
    jwt_expires_minutes: int = int(os.getenv("JWT_EXPIRES_MINUTES", "10080"))
    auth_cookie_name: str = os.getenv("AUTH_COOKIE_NAME", "auth_token")
    admin_username: str = os.getenv("ADMIN_USERNAME", "admin")
    admin_email: str = os.getenv("ADMIN_EMAIL", "admin@aquawatch.com")
    admin_password: str = os.getenv("ADMIN_PASSWORD", "admin123")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "AIzaSyBUQZ4ot571dKAyGIajw9Ry7g9i-FKMPRg")


settings = Settings()
