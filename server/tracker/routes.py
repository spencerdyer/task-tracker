"""The tracker's HTTP API (see service.py and guide.md).

Agents drive it with plain HTTP and a project token (``Authorization: Bearer tt_…``); the web app
is the owner's view. Every change sends a ``tracker_changed`` event to open web apps, and a ticket
reaching User acceptance also sends ``tracker_review_ready``.
"""
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy.orm import Session

from . import auth, models
from . import service as svc
from .db import get_db
from .events import broadcast_sync_event
from .auth import get_principal

router = APIRouter(prefix="/tracker", tags=["tracker"])

GUIDE = Path(__file__).resolve().parent / "guide.md"


def _actor(request: Request, principal: auth.Principal = Depends(get_principal),
           db: Session = Depends(get_db)) -> svc.Actor:
    try:
        return svc.actor_for(db, principal, request.client.host if request.client else None)
    except svc.TrackerError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except svc.TrackerError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc


async def _json(request: Request) -> Dict[str, Any]:
    try:
        data = await request.json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Send a JSON object.") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Send a JSON object.")
    return data


async def _changed(ticket: Dict[str, Any], kind: str, previous: Optional[str] = None) -> None:
    payload = {"project": ticket["project"]["key"], "ticket": ticket["key"], "kind": kind,
               "status": ticket["status"], "title": ticket["title"], "owner": ticket["owner"]}
    await broadcast_sync_event("tracker_changed", payload)
    if kind == "status" and ticket["status"] == "uat" and previous != "uat":
        await broadcast_sync_event("tracker_review_ready", payload)


# ---------------------------------------------------------------- meta, guide, identity

@router.get("/meta")
async def meta():
    return svc.meta()


@router.get("/guide", response_class=PlainTextResponse)
def guide(request: Request):
    """How agents use the Tracker. Readable with any valid project token."""
    text = GUIDE.read_text(encoding="utf-8")
    return text.replace("{BASE}", str(request.base_url).rstrip("/") + "/api/tracker")


@router.get("/me")
def me(actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    return svc.whoami(db, actor)


# ---------------------------------------------------------------- projects

@router.get("/projects")
def projects(actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    return {"projects": svc.list_projects(db, actor)}


@router.post("/projects")
async def create_project(request: Request, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    data = await _json(request)
    out = _run(svc.create_project, db, actor, data.get("key", ""), data.get("name", ""), data.get("description", ""))
    await broadcast_sync_event("tracker_changed", {"project": out["key"], "kind": "project"})
    return out


@router.patch("/projects/{project_key}")
async def update_project(project_key: str, request: Request, actor: svc.Actor = Depends(_actor),
                         db: Session = Depends(get_db)):
    out = _run(svc.update_project, db, actor, project_key, await _json(request))
    await broadcast_sync_event("tracker_changed", {"project": out["key"], "kind": "project"})
    return out


# ---------------------------------------------------------------- shared machines

@router.get("/projects/{project_key}/resources")
async def resources(project_key: str, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    """The project's machines, each with the in-progress/testing tickets holding it."""
    return {"resources": _run(svc.list_resources, db, actor, project_key)}


@router.post("/projects/{project_key}/resources")
async def create_resource(project_key: str, request: Request, actor: svc.Actor = Depends(_actor),
                          db: Session = Depends(get_db)):
    out = _run(svc.create_resource, db, actor, project_key, await _json(request))
    await broadcast_sync_event("tracker_changed", {"project": project_key.upper(), "kind": "resources"})
    return out


@router.patch("/projects/{project_key}/resources/{resource_key}")
async def update_resource(project_key: str, resource_key: str, request: Request, actor: svc.Actor = Depends(_actor),
                          db: Session = Depends(get_db)):
    out = _run(svc.update_resource, db, actor, project_key, resource_key, await _json(request))
    await broadcast_sync_event("tracker_changed", {"project": project_key.upper(), "kind": "resources"})
    return out


@router.delete("/projects/{project_key}/resources/{resource_key}")
async def delete_resource(project_key: str, resource_key: str, actor: svc.Actor = Depends(_actor),
                          db: Session = Depends(get_db)):
    _run(svc.delete_resource, db, actor, project_key, resource_key)
    await broadcast_sync_event("tracker_changed", {"project": project_key.upper(), "kind": "resources"})
    return {"ok": True}


# ---------------------------------------------------------------- tickets

@router.get("/projects/{project_key}/tickets")
def tickets(project_key: str, owner: Optional[str] = None, status: Optional[str] = None,
                  attention: bool = False, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    return {"tickets": _run(svc.list_tickets, db, actor, project_key, owner, status, attention)}


@router.post("/projects/{project_key}/tickets")
async def create_ticket(project_key: str, request: Request, actor: svc.Actor = Depends(_actor),
                        db: Session = Depends(get_db)):
    ticket = _run(svc.create_ticket, db, actor, project_key, await _json(request))
    await _changed(ticket, "created")
    return ticket


@router.get("/projects/{project_key}/changes")
def changes(project_key: str, since: float = 0, actor: svc.Actor = Depends(_actor),
                  db: Session = Depends(get_db)):
    return {"changes": _run(svc.changes_since, db, actor, project_key, since)}


@router.get("/projects/{project_key}/agents")
async def agents(project_key: str, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    """Who is working on what, who is idle, and what waits on the user."""
    return _run(svc.project_agents, db, actor, project_key)


@router.get("/projects/{project_key}/waiting-on-you")
def waiting_on_you(project_key: str, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    """What waits for the owner: agents' open questions and work to review, oldest first;
    blocked:user tickets with no question asked yet apart, as `unasked`."""
    return _run(svc.waiting_on_you, db, actor, project_key)


@router.get("/projects/{project_key}/stale")
def stale(project_key: str, minutes: int = svc.STALE_DEFAULT, actor: svc.Actor = Depends(_actor),
          db: Session = Depends(get_db)):
    """In progress / testing tickets whose owner hasn't posted within `minutes`."""
    return _run(svc.stale_work, db, actor, project_key, minutes)


@router.get("/projects/{project_key}/chat")
def chat(project_key: str, since: Optional[int] = None, before: Optional[int] = None, limit: int = svc.CHAT_PAGE,
         actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    """The project chat between the owner and the agents, newest last; `since` a message id."""
    return _run(svc.chat_messages, db, actor, project_key, since, before, limit)


@router.post("/projects/{project_key}/chat")
async def post_chat(project_key: str, request: Request, actor: svc.Actor = Depends(_actor),
                    db: Session = Depends(get_db)):
    """Post {author, body, to?, tickets?}. A leading @name sets `to`; ticket keys in the text become cards."""
    msg = _run(svc.post_message, db, actor, project_key, await _json(request))
    await broadcast_sync_event("tracker_chat", {
        "project": project_key.upper(), "kind": "message", "id": msg["id"], "author": msg["author"],
        "to": msg["to"], "preview": msg["body"][:140]})
    return msg


@router.get("/projects/{project_key}/chat/unread")
def chat_unread(project_key: str, for_: str = Query("", alias="for"), actor: svc.Actor = Depends(_actor),
                db: Session = Depends(get_db)):
    """An agent's unread messages: the owner's, to it or to everyone, since its last post or read
    marker. The owner (no `for`) gets the agents' messages it hasn't read."""
    return _run(svc.chat_unread, db, actor, project_key, for_)


@router.post("/projects/{project_key}/chat/read")
async def chat_read(project_key: str, request: Request, actor: svc.Actor = Depends(_actor),
                    db: Session = Depends(get_db)):
    """{author, upto?}: read up to that message id (default: the latest)."""
    data = await _json(request)
    out = _run(svc.chat_mark_read, db, actor, project_key, data.get("author", ""), data.get("upto"))
    await broadcast_sync_event("tracker_chat", {"project": project_key.upper(), "kind": "read", "for": out["for"],
                                                "upto": out["upto"]})
    return out


# ---------------------------------------------------------------- questions

async def _question_event(q: Dict[str, Any], kind: str) -> None:
    project = q["ticket"]["key"].split("-")[0]
    await broadcast_sync_event("tracker_question", {"project": project, "ticket": q["ticket"]["key"], "id": q["id"],
                                                    "kind": kind, "status": q["status"], "asked_by": q["asked_by"],
                                                    "title": q["title"]})
    await broadcast_sync_event("tracker_changed", {"project": project, "ticket": q["ticket"]["key"], "kind": "question",
                                                   "status": q["ticket"]["status"], "title": q["ticket"]["title"],
                                                   "owner": q["ticket"]["owner"]})


@router.post("/tickets/{ticket_key}/questions")
async def ask_question(ticket_key: str, request: Request, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    """{author, title, body, options?: [{label, detail}], recommended?}: ask the user a question on this ticket."""
    data = await _json(request)
    out = _run(svc.ask_question, db, actor, ticket_key, data)
    await _question_event(out, "asked")
    return out


@router.get("/projects/{project_key}/questions")
async def list_questions(project_key: str, status: Optional[str] = None, asked_by: Optional[str] = None,
                         ticket: Optional[str] = None, limit: int = 200,
                         actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    """Questions: open first (waiting longest first), then answered, then closed. Agents check
    ?asked_by=<you>&status=answered every turn for the user's answers."""
    return _run(svc.list_questions, db, actor, project_key, status, asked_by, ticket, limit)


@router.get("/questions/{question_id}")
async def get_question(question_id: int, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    return _run(svc.get_question, db, actor, question_id)


@router.post("/questions/{question_id}/replies")
async def reply_question(question_id: int, request: Request, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    """{author, body, choice?}: the user answers (choice: an option's label), or the asking agent replies."""
    data = await _json(request)
    out = _run(svc.reply_question, db, actor, question_id, data)
    await _question_event(out, "reply")
    if out.get("ping"):  # the asker's chat ping
        await broadcast_sync_event("tracker_chat", {"project": out["ticket"]["key"].split("-")[0], "kind": "message",
                                                    "id": out["ping"]["id"], "author": svc.TRACKER, "to": out["ping"]["to"],
                                                    "preview": out["ping"]["body"][:140]})
    return out


@router.post("/questions/{question_id}/resolve")
async def resolve_question(question_id: int, request: Request, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    """{author, note?}: the asking agent (or the user) closes it as settled."""
    data = await _json(request)
    out = _run(svc.close_question, db, actor, question_id, "resolved", data)
    await _question_event(out, "resolved")
    return out


@router.post("/questions/{question_id}/withdraw")
async def withdraw_question(question_id: int, request: Request, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    """{author, note?}: the asking agent no longer needs an answer."""
    data = await _json(request)
    out = _run(svc.close_question, db, actor, question_id, "withdrawn", data)
    await _question_event(out, "withdrawn")
    return out


@router.get("/projects/{project_key}/next")
async def next_tickets(project_key: str, author: str = "", actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    """The to-dos `author` can start now, in order (priority, then rank), and why the others can't."""
    return _run(svc.next_tickets, db, actor, project_key, author)


@router.post("/tickets/{ticket_key}/claim")
async def claim_ticket(ticket_key: str, request: Request, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    """Take a startable to-do: you become its owner and it moves to in_progress, in one step."""
    data = await _json(request)
    ticket = _run(svc.claim_ticket, db, actor, ticket_key, data.get("author", ""))
    await _changed(ticket, "status", "todo")
    return ticket


@router.get("/tickets/{ticket_key}")
def ticket(ticket_key: str, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    return _run(svc.get_ticket, db, actor, ticket_key)


@router.patch("/tickets/{ticket_key}")
async def update_ticket(ticket_key: str, request: Request, actor: svc.Actor = Depends(_actor),
                        db: Session = Depends(get_db)):
    ticket = _run(svc.update_ticket, db, actor, ticket_key, await _json(request))
    await _changed(ticket, "edit")
    return ticket


@router.post("/tickets/{ticket_key}/move")
async def move_ticket(ticket_key: str, request: Request, actor: svc.Actor = Depends(_actor),
                      db: Session = Depends(get_db)):
    data = await _json(request)
    rank = data.get("rank")
    before = _run(svc.get_ticket, db, actor, ticket_key)["status"]
    ticket = _run(svc.move_ticket, db, actor, ticket_key, str(data.get("status", "")), data.get("author", ""),
                  data.get("note", "") or "", float(rank) if rank is not None else None)
    await _changed(ticket, "status", before)
    return ticket


@router.post("/tickets/{ticket_key}/events")
async def add_event(
    ticket_key: str,
    author: str = Form(""),
    kind: str = Form("note"),
    body: str = Form(""),
    files: Optional[List[UploadFile]] = File(None),
    actor: svc.Actor = Depends(_actor),
    db: Session = Depends(get_db),
):
    loaded = []
    for upload in files or []:
        loaded.append((upload.filename or "file", upload.content_type, await upload.read()))
    ticket = _run(svc.add_event, db, actor, models.OWNER_ID, ticket_key, author, kind, body, loaded)
    await _changed(ticket, kind)
    return ticket


@router.get("/attachments/{att_id}")
def get_attachment(att_id: str, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    path, mime, filename = _run(svc.attachment, db, actor, att_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="The attachment's file is missing.")
    return FileResponse(path, media_type=mime, filename=filename, content_disposition_type="inline")


# ---------------------------------------------------------------- access tokens (owner only)

@router.get("/projects/{project_key}/tokens")
def tokens(project_key: str, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    return {"tokens": _run(svc.list_tokens, db, actor, project_key)}


@router.post("/projects/{project_key}/tokens")
async def create_token(project_key: str, request: Request, actor: svc.Actor = Depends(_actor),
                       db: Session = Depends(get_db)):
    info, token = _run(svc.create_token, db, actor, project_key, await _json(request))
    base = str(request.base_url).rstrip("/") + "/api/tracker"
    return {**info, "token": token, "base_url": base, "guide_url": base + "/guide"}


@router.delete("/tokens/{token_id}")
def revoke_token(token_id: int, actor: svc.Actor = Depends(_actor), db: Session = Depends(get_db)):
    _run(svc.revoke_token, db, actor, token_id)
    return {"ok": True}


# ---------------------------------------------------------------- the owner's board selection

VIEW_SETTING = "tracker_view"


@router.get("/view")
def get_view(_owner: auth.Principal = Depends(auth.require_owner), db: Session = Depends(get_db)):
    """Which projects the owner's board shows (several at once), kept on the server so every browser follows."""
    row = db.get(models.Setting, VIEW_SETTING)
    return {"projects": list((row.value or {}).get("projects") or []) if row else []}


@router.put("/view")
async def put_view(request: Request, _owner: auth.Principal = Depends(auth.require_owner),
                   db: Session = Depends(get_db)):
    data = await _json(request)
    given = data.get("projects")
    if not isinstance(given, list) or not all(isinstance(k, str) for k in given) or len(given) > 200:
        raise HTTPException(status_code=400, detail="Send {\"projects\": [project keys]}.")
    known = {p.key for p in db.query(models.TrackerProject).all()}
    seen, projects = set(), []
    for key in given:
        key = key.upper()
        if key in known and key not in seen:
            seen.add(key)
            projects.append(key)
    projects = projects[:30]
    row = db.get(models.Setting, VIEW_SETTING)
    if row is None:
        db.add(models.Setting(name=VIEW_SETTING, value={"projects": projects}))
    else:
        row.value = {"projects": projects}
    db.commit()
    await broadcast_sync_event("tracker_view_changed", {"projects": projects})
    return {"projects": projects}
