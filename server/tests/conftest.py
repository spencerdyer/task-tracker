"""Test fixtures: every test gets its own data folder and database, and a signed-in owner client.

`client` is the owner's browser (session cookie). `agent(token)` is an agent calling with a project token.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tracker import auth, db as database, events
from tracker.main import create_app

OWNER_PASSWORD = "owner-password-1"


@pytest.fixture(autouse=True)
def fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("TRACKER_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("TRACKER_WEB_DIST", str(tmp_path / "no-web"))
    database.init(f"sqlite:///{tmp_path / 'test.db'}")
    auth.throttle = auth.Throttle()
    yield
    events.hub._sockets.clear()


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
def anon(app):
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def client(app):
    c = TestClient(app, raise_server_exceptions=False)
    res = c.post("/api/auth/setup", json={"password": OWNER_PASSWORD})
    assert res.status_code == 200, res.text
    return c


@pytest.fixture
def agent(app):
    def make(token: str) -> TestClient:
        c = TestClient(app, raise_server_exceptions=False)
        c.headers["Authorization"] = f"Bearer {token}"
        return c
    return make


@pytest.fixture
def captured(monkeypatch):
    """Every live event the server sends, as (type, data)."""
    seen: list[tuple[str, dict]] = []

    async def record(kind, data):
        seen.append((kind, data))

    from tracker import routes
    monkeypatch.setattr(routes, "broadcast_sync_event", record)
    return seen
