"""Settings loaded from the project-root .env (and backend/.env if present)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent

# Project-root .env first, then an optional backend/.env (does not override).
load_dotenv(PROJECT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env")


def _path(name: str, default: str = "") -> str:
    """Cert paths may be relative: they are resolved against the project root."""
    value = os.getenv(name, default).strip()
    if not value:
        return ""
    p = Path(value).expanduser()
    if not p.is_absolute():
        p = (PROJECT_DIR / p).resolve()
    return str(p)


def _list(name: str, default: str) -> list[str]:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


@dataclass(frozen=True)
class Settings:
    db_url: str = field(default_factory=lambda: os.getenv("DB_URL", "").strip())
    supabase_url: str = field(default_factory=lambda: os.getenv("SUPABASE_URL", "").strip())

    aws_iot_endpoint: str = field(default_factory=lambda: os.getenv("AWS_IOT_ENDPOINT", "").strip())
    aws_iot_port: int = field(default_factory=lambda: int(os.getenv("AWS_IOT_PORT", "8883")))
    aws_iot_ca_path: str = field(default_factory=lambda: _path("AWS_IOT_CA_PATH"))
    aws_iot_cert_path: str = field(default_factory=lambda: _path("AWS_IOT_CERT_PATH"))
    aws_iot_key_path: str = field(default_factory=lambda: _path("AWS_IOT_KEY_PATH"))
    aws_iot_client_id: str = field(default_factory=lambda: os.getenv("AWS_IOT_CLIENT_ID", "greenhouse-backend").strip())

    sensor_topics: list[str] = field(
        default_factory=lambda: _list("SENSOR_TOPICS", "sensor/co2,sensor/npk,sensor/soil-moisture"))
    relay_topic: str = field(default_factory=lambda: os.getenv("RELAY_TOPIC", "action/relay").strip())

    cors_origins: list[str] = field(default_factory=lambda: _list("CORS_ORIGINS", "*"))
    relay_api_key: str = field(default_factory=lambda: os.getenv("RELAY_API_KEY", "").strip())
    relay_min_interval_s: float = field(default_factory=lambda: float(os.getenv("RELAY_MIN_INTERVAL_S", "1.0")))

    def check(self) -> list[str]:
        """Human-readable problems that stop the backend from working."""
        problems = []
        if not self.db_url:
            problems.append("DB_URL is not set")
        if not self.aws_iot_endpoint:
            problems.append("AWS_IOT_ENDPOINT is not set")
        for name, path in (("AWS_IOT_CA_PATH", self.aws_iot_ca_path),
                           ("AWS_IOT_CERT_PATH", self.aws_iot_cert_path),
                           ("AWS_IOT_KEY_PATH", self.aws_iot_key_path)):
            if not path:
                problems.append(f"{name} is not set")
            elif not Path(path).is_file():
                problems.append(f"{name} file not found: {path}")
        return problems


settings = Settings()
