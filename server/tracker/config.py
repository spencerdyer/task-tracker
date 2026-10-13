"""Settings, all from environment variables. Nothing here points at any real machine.

TRACKER_DATA_DIR       where the database and attachments live (default: ./data next to where you start it)
TRACKER_HOST           address to listen on (default 127.0.0.1: this computer only)
TRACKER_PORT           port (default 8765)
TRACKER_SESSION_DAYS   how long a sign-in lasts without use (default 30)
TRACKER_SECURE_COOKIES 1 when served over HTTPS, so the session cookie is only sent over HTTPS (default 0)
TRACKER_ALLOWED_ORIGINS  comma-separated extra origins allowed to call the API from a browser (default none)
TRACKER_WEB_DIST       the built web app to serve (default: web/dist in this repository, when it exists)
"""
from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    path = Path(os.environ.get("TRACKER_DATA_DIR") or (Path.cwd() / "data")).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def host() -> str:
    return os.environ.get("TRACKER_HOST", "127.0.0.1")


def port() -> int:
    return int(os.environ.get("TRACKER_PORT", "8765"))


def session_days() -> float:
    return float(os.environ.get("TRACKER_SESSION_DAYS", "30"))


def secure_cookies() -> bool:
    return os.environ.get("TRACKER_SECURE_COOKIES", "0") in ("1", "true", "yes")


def allowed_origins() -> list[str]:
    return [o.strip() for o in os.environ.get("TRACKER_ALLOWED_ORIGINS", "").split(",") if o.strip()]


def web_dist() -> Path:
    return Path(os.environ.get("TRACKER_WEB_DIST") or (REPO_ROOT / "web" / "dist")).expanduser().resolve()
