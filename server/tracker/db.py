"""The SQLite database: one file in the data folder, foreign keys enforced."""
from __future__ import annotations

from typing import Iterator, Optional

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from . import config, models

_engine: Optional[Engine] = None
_Session: Optional[sessionmaker] = None


def _on_connect(dbapi_connection, _record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


def init(url: Optional[str] = None) -> Engine:
    """Open (and create) the database. Tests pass their own URL."""
    global _engine, _Session
    if _engine is not None:
        _engine.dispose()
    url = url or f"sqlite:///{config.data_dir() / 'tracker.db'}"
    _engine = create_engine(url, connect_args={"check_same_thread": False})
    event.listen(_engine, "connect", _on_connect)
    models.Base.metadata.create_all(_engine)
    _Session = sessionmaker(bind=_engine, autoflush=False)
    return _engine


def session() -> Session:
    if _Session is None:
        init()
    return _Session()


def get_db() -> Iterator[Session]:
    db = session()
    try:
        yield db
    finally:
        db.close()
