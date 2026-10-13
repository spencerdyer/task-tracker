"""The web server: the tracker's API under /api/tracker, the owner's sign-in under /api/auth, live
updates on /api/ws, and the built web app (web/dist) for everything else."""
from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path
from typing import Any, Dict

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy.orm import Session

from . import auth, config, db as database, models
from .events import hub
from .routes import router as tracker_router
from .safety import ContentSafetyMiddleware, app_file_headers

VERSION = "0.1.0"


def create_app() -> FastAPI:
    app = FastAPI(title="Task Tracker", version=VERSION, docs_url="/api/docs", redoc_url=None,
                  openapi_url="/api/openapi.json")
    origins = config.allowed_origins()
    if origins:
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True,
                           allow_methods=["*"], allow_headers=["*"])
    app.add_middleware(ContentSafetyMiddleware)

    @app.on_event("startup")
    def _startup() -> None:
        if database._engine is None:  # tests open their own database first
            database.init()

    app.include_router(tracker_router, prefix="/api")

    # ------------------------------------------------------------ health and sign-in

    @app.get("/api/health")
    def health() -> Dict[str, Any]:
        return {"ok": True, "version": VERSION}

    def _set_cookie(response: Response, token: str) -> None:
        response.set_cookie(auth.SESSION_COOKIE, token, httponly=True, samesite="strict",
                            secure=config.secure_cookies(), max_age=int(config.session_days() * 86400), path="/")

    async def _body(request: Request) -> Dict[str, Any]:
        try:
            data = await request.json()
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="Send a JSON object.") from exc
        if not isinstance(data, dict):
            raise HTTPException(status_code=400, detail="Send a JSON object.")
        return data

    def _address(request: Request) -> str:
        return request.client.host if request.client else "?"

    @app.get("/api/auth/status")
    def auth_status(request: Request, db: Session = Depends(database.get_db)) -> Dict[str, Any]:
        found = auth.principal_from(db, None, request.cookies.get(auth.SESSION_COOKIE))
        return {"setup_needed": auth.owner(db) is None, "signed_in": found is not None}

    @app.post("/api/auth/setup")
    async def auth_setup(request: Request, db: Session = Depends(database.get_db)):
        """First run only: set the owner's password, and sign in."""
        if auth.owner(db) is not None:
            raise HTTPException(status_code=409, detail="The owner's password is already set; sign in.")
        password = auth.validate_password((await _body(request)).get("password"))
        db.add(models.Owner(id=models.OWNER_ID, password_hash=auth.hash_password(password)))
        db.commit()
        response = JSONResponse({"signed_in": True})
        _set_cookie(response, auth.new_session(db))
        return response

    @app.post("/api/auth/login")
    async def auth_login(request: Request, db: Session = Depends(database.get_db)):
        address = _address(request)
        wait = auth.throttle.wait(address)
        if wait > 0:
            raise HTTPException(status_code=429, detail=f"Too many tries. Wait {int(wait) + 1} s.",
                                headers={"Retry-After": str(int(wait) + 1)})
        row = auth.owner(db)
        if row is None:
            raise HTTPException(status_code=409, detail="Set the owner's password first.")
        password = (await _body(request)).get("password")
        if not isinstance(password, str) or not auth.check_password(password, row.password_hash):
            auth.throttle.failed(address)
            raise HTTPException(status_code=401, detail="That password isn't right.")
        auth.throttle.succeeded(address)
        response = JSONResponse({"signed_in": True})
        _set_cookie(response, auth.new_session(db))
        return response

    @app.post("/api/auth/logout")
    def auth_logout(request: Request, db: Session = Depends(database.get_db)):
        auth.end_session(db, request.cookies.get(auth.SESSION_COOKIE))
        response = JSONResponse({"signed_in": False})
        response.delete_cookie(auth.SESSION_COOKIE, path="/")
        return response

    @app.post("/api/auth/password")
    async def auth_password(request: Request, _owner: auth.Principal = Depends(auth.require_owner),
                            db: Session = Depends(database.get_db)):
        """Change the owner's password. Every other signed-in browser is signed out."""
        data = await _body(request)
        row = auth.owner(db)
        if row is None or not auth.check_password(str(data.get("current") or ""), row.password_hash):
            raise HTTPException(status_code=401, detail="The current password isn't right.")
        new = auth.validate_password(data.get("new"))
        if new == data.get("current"):
            raise HTTPException(status_code=400, detail="Choose a password different from the current one.")
        row.password_hash = auth.hash_password(new)
        db.commit()
        auth.end_all_sessions(db)
        response = JSONResponse({"signed_in": True})
        _set_cookie(response, auth.new_session(db))
        return response

    # ------------------------------------------------------------ live updates

    @app.websocket("/api/ws")
    async def live(ws: WebSocket) -> None:
        db = database.session()
        try:
            found = auth.principal_from(db, None, ws.cookies.get(auth.SESSION_COOKIE))
        finally:
            db.close()
        if found is None or found.method != "session":
            await ws.close(code=4401)
            return
        await ws.accept()
        await hub.add(ws)
        try:
            await ws.send_json({"type": "sync_hello", "data": {}})
            while True:
                try:
                    await asyncio.wait_for(ws.receive_text(), timeout=30)
                except asyncio.TimeoutError:
                    await ws.send_json({"type": "ping", "data": {}})
        except WebSocketDisconnect:
            pass
        finally:
            await hub.remove(ws)

    # ------------------------------------------------------------ the web app

    dist = config.web_dist()

    @app.get("/{path:path}", include_in_schema=False)
    def web(path: str):
        if path.startswith("api/") or path == "api":
            raise HTTPException(status_code=404, detail="Not found.")
        if not (dist / "index.html").is_file():
            return JSONResponse({"detail": "The web app isn't built yet: run `npm run build` in web/."},
                                status_code=404)
        target = (dist / path).resolve()
        with contextlib.suppress(ValueError):
            target.relative_to(dist)
            if path and target.is_file():
                return FileResponse(target, headers=app_file_headers())
        return FileResponse(dist / "index.html", headers=app_file_headers([("cache-control", "no-cache")]))

    return app


app = create_app()


def run() -> None:
    """`tracker-server`: start on TRACKER_HOST:TRACKER_PORT (default 127.0.0.1:8765)."""
    import uvicorn
    uvicorn.run("tracker.main:app", host=config.host(), port=config.port())


if __name__ == "__main__":
    run()
