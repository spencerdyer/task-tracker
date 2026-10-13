"""Who is calling: the owner (a signed-in browser) or an agent (a project token).

The owner sets a password on first run and signs in with it; the browser keeps an httpOnly,
SameSite=Strict session cookie. Agents send ``Authorization: Bearer tt_…`` (a project token made
in the web app's Access dialog). Only SHA-256 hashes of session and project tokens are stored;
the password is kept as a salted scrypt hash.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from . import config, db as database, models

TRACKER_TOKEN_PREFIX = "tt_"  # project access tokens for agents
SESSION_PREFIX = "tts_"
SESSION_COOKIE = "tracker_session"
SESSION_TOUCH = timedelta(minutes=5)  # how stale last_used_at may get before a request renews the session
MIN_PASSWORD = 8

# Password hashing: scrypt from the standard library (no native dependency to install)
_SCRYPT = {"n": 2 ** 14, "r": 8, "p": 1, "dklen": 32}


@dataclass
class Principal:
    method: str  # "session" (the owner) | "tracker_token" (an agent)
    tracker_token_id: Optional[int] = None


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    """SQLite drops tzinfo on read; stored values are UTC."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$")
    except ValueError:
        return False
    if scheme != "scrypt":
        return False
    got = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt), **_SCRYPT)
    return hmac.compare_digest(got.hex(), digest)


def invalidate_tracker_token(token_id: int) -> None:
    """Called when a token is revoked. Tokens are looked up on every request, so nothing is cached."""


# ---------------------------------------------------------------- the owner

def owner(db: Session) -> Optional[models.Owner]:
    return db.query(models.Owner).first()


def validate_password(password: str) -> str:
    if not isinstance(password, str) or len(password) < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"Use a password of at least {MIN_PASSWORD} characters.")
    if len(password) > 1024:
        raise HTTPException(status_code=400, detail="That password is too long.")
    return password


def new_session(db: Session) -> str:
    token = SESSION_PREFIX + secrets.token_urlsafe(32)
    now = utcnow()
    db.add(models.OwnerSession(token_hash=hash_token(token), created_at=now, last_used_at=now,
                               expires_at=now + timedelta(days=config.session_days())))
    db.commit()
    return token


def end_session(db: Session, token: Optional[str]) -> None:
    if token:
        db.query(models.OwnerSession).filter(models.OwnerSession.token_hash == hash_token(token)).delete()
        db.commit()


def end_all_sessions(db: Session) -> None:
    db.query(models.OwnerSession).delete()
    db.commit()


def _session_principal(db: Session, token: str) -> Optional[Principal]:
    row = db.query(models.OwnerSession).filter(models.OwnerSession.token_hash == hash_token(token)).first()
    if row is None:
        return None
    now = utcnow()
    if _aware(row.expires_at) <= now:
        db.delete(row)
        db.commit()
        return None
    last = _aware(row.last_used_at)
    if last is None or now - last >= SESSION_TOUCH:
        row.last_used_at = now
        row.expires_at = now + timedelta(days=config.session_days())
        db.commit()
    return Principal(method="session")


def _token_principal(db: Session, token: str) -> Optional[Principal]:
    row = db.query(models.TrackerToken).filter(models.TrackerToken.token_hash == hash_token(token)).first()
    if row is None or row.revoked_at is not None:
        return None
    expires = _aware(row.expires_at)
    if expires is not None and expires <= utcnow():
        return None
    return Principal(method="tracker_token", tracker_token_id=row.id)


def principal_from(db: Session, authorization: Optional[str], cookie: Optional[str]) -> Optional[Principal]:
    """The caller, from a bearer project token or the session cookie; None if neither is valid."""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token.startswith(TRACKER_TOKEN_PREFIX):
            return _token_principal(db, token)
        if token.startswith(SESSION_PREFIX):
            return _session_principal(db, token)
        return None
    if cookie:
        return _session_principal(db, cookie)
    return None


def get_principal(request: Request, db: Session = Depends(database.get_db)) -> Principal:
    found = principal_from(db, request.headers.get("authorization"), request.cookies.get(SESSION_COOKIE))
    if found is None:
        raise HTTPException(status_code=401, detail="Sign in, or send a project token.")
    return found


def require_owner(principal: Principal = Depends(get_principal)) -> Principal:
    if principal.method != "session":
        raise HTTPException(status_code=403, detail="Only the signed-in owner can do that.")
    return principal


# ---------------------------------------------------------------- sign-in throttling

class Throttle:
    """Failed sign-ins slow down per address: 5 free, then 1, 2, 4… seconds, up to 15 minutes."""

    FREE = 5
    MAX_WAIT = 15 * 60

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._fails: dict[str, tuple[int, float]] = {}

    def wait(self, address: str) -> float:
        with self._lock:
            count, last = self._fails.get(address, (0, 0.0))
        if count < self.FREE:
            return 0.0
        delay = min(self.MAX_WAIT, 2 ** (count - self.FREE))
        return max(0.0, last + delay - time.time())

    def failed(self, address: str) -> None:
        with self._lock:
            count, _ = self._fails.get(address, (0, 0.0))
            self._fails[address] = (count + 1, time.time())
            if len(self._fails) > 10000:  # bounded: forget the oldest half
                for key in sorted(self._fails, key=lambda k: self._fails[k][1])[:5000]:
                    del self._fails[key]

    def succeeded(self, address: str) -> None:
        with self._lock:
            self._fails.pop(address, None)


throttle = Throttle()
