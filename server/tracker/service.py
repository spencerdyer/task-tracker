"""Projects, tickets moving through stages, and each ticket's history.

Shared by the owner and the agents working for them. Tickets move To do -> In progress ->
Testing -> User acceptance -> Done. Agents move their tickets up to User acceptance (only with
a recorded verification); only the signed-in owner approves (Done) or sends a ticket back.
Everything that happens to a ticket is an event in its history.

Who is acting is decided by the credential, not by a name in the request:
  * the owner, signed in: author 'user';
  * an agent: a project token (``tt_…``), limited to one project and to what its switches
    allow. Agents name themselves with ``author`` on each call; 'user' is refused.
"""
from __future__ import annotations

import re
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import auth, config, models
from .safety import recorded_mime

STATUSES = ("todo", "in_progress", "testing", "uat", "done")
STATUS_NAMES = {
    "todo": "To do",
    "in_progress": "In progress",
    "testing": "Testing",
    "uat": "User acceptance",
    "done": "Done",
}
PRIORITIES = ("P0", "P1", "P2", "P3")
USER = "user"  # the author name of the account's owner
TRACKER = "task-tracker"  # the tracker's own chat messages, e.g. 'the user answered your question' (reserved)

# Moves an agent may make; the owner may make any move.
AGENT_MOVES = {
    "todo": {"in_progress"},
    "in_progress": {"todo", "testing"},
    "testing": {"in_progress", "uat"},
    "uat": set(),
    "done": set(),
}

MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]{1,9}$")
_RESOURCE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
ACTIVE = ("in_progress", "testing")  # a ticket in these stages holds the machines it needs
_lock = threading.Lock()  # ticket numbers are handed out one at a time

# Credentials that count as the owner in person.
OWNER_METHODS = {"session"}
TOKEN_TOUCH_INTERVAL = 30.0  # seconds between last-used writes for a busy token


class TrackerError(Exception):
    """A request the Tracker refuses; ``status`` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


@dataclass
class Actor:
    is_owner: bool
    token: Optional[models.TrackerToken] = None
    via: Optional[str] = None  # the owner acting through something else, e.g. an integration

    @property
    def token_name(self) -> Optional[str]:
        return self.token.name if self.token else self.via


def actor_for(db: Session, principal: auth.Principal, ip: Optional[str] = None) -> Actor:
    if principal.method == "tracker_token":
        token = db.get(models.TrackerToken, principal.tracker_token_id)
        if token is None or token.revoked_at is not None:
            raise TrackerError("This token has been revoked.", 401)
        now = auth.utcnow()
        last = auth._aware(token.last_used_at)
        if last is None or (now - last).total_seconds() >= TOKEN_TOUCH_INTERVAL or token.last_used_ip != ip:
            token.last_used_at = now
            token.last_used_ip = ip
            db.commit()
        return Actor(is_owner=False, token=token)
    return Actor(is_owner=principal.method in OWNER_METHODS)


# ---------------------------------------------------------------- helpers

def _author(actor: Actor, value: Any) -> str:
    if actor.is_owner:
        return USER
    import unicodedata
    # Look-alikes of 'user' ('user\u200b', fullwidth 'ｕｓｅｒ') read as the owner to agents
    text = "".join(ch for ch in unicodedata.normalize("NFKC", str(value or "")) if unicodedata.category(ch) != "Cf").strip()
    if not text:
        raise TrackerError("Every change names its author: your agent name, the same on every call.")
    if text.lower() == USER:
        raise TrackerError("The name 'user' belongs to the account's owner; use your agent name.", 403)
    if text.lower() == TRACKER:
        raise TrackerError(f"The name '{TRACKER}' is the Tracker's own; use your agent name.", 403)
    if len(text) > 80:
        raise TrackerError("An author name is at most 80 characters.")
    return text


def _text(value: Any, field: str, limit: int) -> str:
    text = "" if value is None else str(value)
    if len(text) > limit:
        raise TrackerError(f"{field} is at most {limit} characters.")
    return text


def _list(value: Any, field: str) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [part.strip() for part in value.split(",")]
    if not isinstance(value, list):
        raise TrackerError(f"{field} is a list.")
    out: List[str] = []
    for item in value:
        text = str(item).strip()
        if text and text not in out:
            out.append(text[:80])
    return out[:50]


def _touch_author(actor: Actor, author: str) -> None:
    if actor.token is not None and actor.token.last_author != author:
        actor.token.last_author = author


def _project(db: Session, actor: Actor, key: str) -> models.TrackerProject:
    row = db.query(models.TrackerProject).filter(models.TrackerProject.key == str(key).upper()).first()
    if row is None or (actor.token is not None and actor.token.project_id != row.id):
        raise TrackerError(f"No project {key}.", 404)
    return row


def _ticket(db: Session, actor: Actor, key: str) -> models.TrackerTicket:
    row = db.query(models.TrackerTicket).filter(models.TrackerTicket.key == str(key).upper()).first()
    if row is None or (actor.token is not None and actor.token.project_id != row.project_id):
        raise TrackerError(f"No ticket {key}.", 404)
    return row


def _need(actor: Actor, switch: str, what: str) -> None:
    if actor.token is not None and not getattr(actor.token, switch):
        raise TrackerError(f"This token can't {what}.", 403)


def _owned(actor: Actor, ticket: models.TrackerTicket, what: str) -> None:
    """A token limited to one owner writes only to that owner's tickets."""
    only = actor.token.owner_only if actor.token is not None else None
    if only and ticket.owner != only:
        raise TrackerError(f"This token can only {what} tickets owned by {only}; comment instead.", 403)


def _event(db: Session, actor: Actor, ticket_id: int, author: str, kind: str, body: str = "",
           status_from: Optional[str] = None, status_to: Optional[str] = None,
           ts: Optional[float] = None) -> models.TrackerEvent:
    ev = models.TrackerEvent(
        ticket_id=ticket_id, ts=ts or time.time(), author=author, kind=kind, body=body,
        status_from=status_from, status_to=status_to,
        token_id=actor.token.id if actor.token else None, token_name=actor.token_name,
    )
    db.add(ev)
    db.flush()
    return ev


def _needs_attention(db: Session, row: models.TrackerTicket) -> bool:
    """Whether the ticket's owner has something from the user to act on: the user
    commented on or moved it after the owner's last event."""
    if row.status == "done":
        return False
    E = models.TrackerEvent
    last_user = db.query(func.max(E.ts)).filter(E.ticket_id == row.id, E.author == USER, E.kind != "created").scalar()
    if not last_user:
        return False
    last_owner = db.query(func.max(E.ts)).filter(E.ticket_id == row.id, E.author != USER).scalar()
    return last_owner is None or last_user > last_owner


def _summary(db: Session, row: models.TrackerTicket) -> Dict[str, Any]:
    E, A = models.TrackerEvent, models.TrackerAttachment
    counts = db.query(E.kind, func.count()).filter(E.ticket_id == row.id).group_by(E.kind).all()
    files = db.query(func.count()).select_from(A).filter(A.ticket_id == row.id).scalar()
    questions = _question_counts(db, row.id)
    return {
        "key": row.key, "title": row.title, "scope": row.scope, "acceptance": row.acceptance,
        "priority": row.priority, "owner": row.owner, "labels": list(row.labels or []),
        "depends_on": list(row.depends_on or []), "resources": list(row.resources or []), "status": row.status, "rank": row.rank,
        "reopened": row.reopened, "created": row.created, "updated": row.updated,
        "attention": _needs_attention(db, row) or (row.status != "done" and questions["answered"] > 0),
        "counts": {kind: n for kind, n in counts}, "attachments": files,
        "questions": questions,  # open (waiting for the user) and answered (waiting for the agent)
    }


def _resource_keys(db: Session, project_id: int) -> Dict[str, models.TrackerResource]:
    R = models.TrackerResource
    return {r.key: r for r in db.query(R).filter(R.project_id == project_id).all()}


def _clean_resources(db: Session, project_id: int, value: Any) -> List[str]:
    keys = [k.lower() for k in _list(value, "resources")]
    known = _resource_keys(db, project_id)
    unknown = [k for k in keys if k not in known]
    if unknown:
        raise TrackerError(f"No machine {', '.join(unknown)} in this project. Known: {', '.join(sorted(known)) or 'none yet'}.")
    return keys


def _holders(db: Session, project_id: int) -> Dict[str, List[Dict[str, Any]]]:
    """resource key -> the in-progress/testing tickets that need it, with since when."""
    T, E = models.TrackerTicket, models.TrackerEvent
    active = db.query(T).filter(T.project_id == project_id, T.status.in_(ACTIVE)).all()
    out: Dict[str, List[Dict[str, Any]]] = {}
    for t in active:
        if not t.resources:
            continue
        # Since it last went active from a non-active stage
        moves = db.query(E).filter(E.ticket_id == t.id, E.kind == "status").order_by(E.ts).all()
        since = None
        for m in moves:
            if m.status_to in ACTIVE and m.status_from not in ACTIVE:
                since = m.ts
        for key in t.resources:
            out.setdefault(key, []).append({"ticket": t.key, "title": t.title, "owner": t.owner, "status": t.status,
                                            "since": since or t.updated})
    return out


def _waits(row: models.TrackerTicket, holders: Dict[str, List[Dict[str, Any]]],
           names: Dict[str, str]) -> List[Dict[str, Any]]:
    """For a to-do: the machines it needs that other tickets hold right now. Work waiting for
    review (or done) needs no machine any more, so it waits for nothing."""
    if row.status != "todo":
        return []
    return [{"resource": k, "name": names.get(k, k), "held_by": [h["ticket"] for h in holders[k]]}
            for k in (row.resources or []) if holders.get(k)]


def _next_rank(db: Session, project_id: int, status: str) -> float:
    T = models.TrackerTicket
    top = db.query(func.max(T.rank)).filter(T.project_id == project_id, T.status == status).scalar()
    return (top or 0) + 1


# ---------------------------------------------------------------- meta and identity

def meta() -> Dict[str, Any]:
    return {
        "statuses": [{"key": k, "name": STATUS_NAMES[k]} for k in STATUSES],
        "priorities": list(PRIORITIES),
        "agent_moves": {k: sorted(v) for k, v in AGENT_MOVES.items()},
        "user_author": USER,
    }


def token_info(db: Session, token: models.TrackerToken) -> Dict[str, Any]:
    project = db.get(models.TrackerProject, token.project_id)
    return {
        "id": token.id, "name": token.name, "prefix": token.prefix,
        "project": project.key if project else None,
        "can_create": token.can_create, "can_edit": token.can_edit,
        "can_move": token.can_move, "can_comment": token.can_comment,
        "owner_only": token.owner_only,
        "expires_at": token.expires_at.isoformat() if token.expires_at else None,
        "last_used_at": token.last_used_at.isoformat() if token.last_used_at else None,
        "last_used_ip": token.last_used_ip, "last_author": token.last_author,
        "revoked": token.revoked_at is not None,
        "created_at": token.created_at.isoformat() if token.created_at else None,
    }


def whoami(db: Session, actor: Actor) -> Dict[str, Any]:
    return {
        "is_owner": actor.is_owner,
        "can_approve": actor.is_owner,
        "token": token_info(db, actor.token) if actor.token else None,
    }


# ---------------------------------------------------------------- projects

def list_projects(db: Session, actor: Actor) -> List[Dict[str, Any]]:
    q = db.query(models.TrackerProject)
    if actor.token is not None:
        q = q.filter(models.TrackerProject.id == actor.token.project_id)
    out = []
    T = models.TrackerTicket
    for row in q.order_by(models.TrackerProject.name).all():
        counts = db.query(T.status, func.count()).filter(T.project_id == row.id).group_by(T.status).all()
        review = db.query(func.count()).select_from(T).filter(T.project_id == row.id, T.status == "uat").scalar()
        out.append({
            "key": row.key, "name": row.name, "description": row.description, "created": row.created,
            "counts": {status: n for status, n in counts}, "awaiting_review": review,
        })
    return out


def create_project(db: Session, actor: Actor, key: str, name: str, description: str = "") -> Dict[str, Any]:
    if not actor.is_owner:
        raise TrackerError("Only the account's owner creates projects.", 403)
    key = str(key or "").strip().upper()
    if not _KEY_RE.match(key):
        raise TrackerError("A project key is 2-10 capital letters or digits, starting with a letter (e.g. HD).")
    name = _text(name, "name", 120).strip()
    if not name:
        raise TrackerError("A project needs a name.")
    with _lock:
        if db.query(models.TrackerProject).filter(models.TrackerProject.key == key).first():
            raise TrackerError(f"Project {key} exists already.", 409)
        db.add(models.TrackerProject(key=key, name=name, description=_text(description, "description", 4000),
                                     created=time.time()))
        db.commit()
    return {"key": key, "name": name, "description": description}


def update_project(db: Session, actor: Actor, key: str, data: Dict[str, Any]) -> Dict[str, Any]:
    if not actor.is_owner:
        raise TrackerError("Only the account's owner edits projects.", 403)
    row = _project(db, actor, key)
    if "name" in data:
        name = _text(data["name"], "name", 120).strip()
        if not name:
            raise TrackerError("A project needs a name.")
        row.name = name
    if "description" in data:
        row.description = _text(data["description"], "description", 4000)
    db.commit()
    return {"key": row.key, "name": row.name, "description": row.description}


# ---------------------------------------------------------------- tickets

def list_tickets(db: Session, actor: Actor, project: str, owner: Optional[str] = None,
                 status: Optional[str] = None, attention: bool = False) -> List[Dict[str, Any]]:
    proj = _project(db, actor, project)
    T = models.TrackerTicket
    q = db.query(T).filter(T.project_id == proj.id)
    if owner:
        q = q.filter(T.owner == owner)
    if status:
        if status not in STATUSES:
            raise TrackerError(f"Unknown status {status}.")
        q = q.filter(T.status == status)
    order = {s: i for i, s in enumerate(STATUSES)}
    rows = sorted(q.all(), key=lambda r: (order.get(r.status, 9), r.rank, r.id))
    holders = _holders(db, proj.id)
    names = {k: r.name for k, r in _resource_keys(db, proj.id).items()}
    tickets = []
    for row in rows:
        summary = _summary(db, row)
        summary["waiting_for"] = _waits(row, holders, names)
        tickets.append(summary)
    if attention:
        tickets = [t for t in tickets if t["attention"]]
    return tickets


def create_ticket(db: Session, actor: Actor, project: str, data: Dict[str, Any]) -> Dict[str, Any]:
    _need(actor, "can_create", "create tickets")
    author = _author(actor, data.get("author"))
    title = _text(data.get("title"), "title", 200).strip()
    if not title:
        raise TrackerError("A ticket needs a title.")
    priority = str(data.get("priority") or "P2").upper()
    if priority not in PRIORITIES:
        raise TrackerError(f"Priority is one of {', '.join(PRIORITIES)}.")
    owner = _text(data.get("owner"), "owner", 80).strip()
    only = actor.token.owner_only if actor.token is not None else None
    if only:
        if owner and owner != only:
            raise TrackerError(f"This token creates tickets owned by {only} only.", 403)
        owner = only
    now = time.time()
    with _lock:
        proj = _project(db, actor, project)
        depends = _list(data.get("depends_on"), "depends_on")
        for dep in depends:
            _ticket(db, actor, dep)
        number = proj.next_number
        key = f"{proj.key}-{number}"
        proj.next_number = number + 1
        row = models.TrackerTicket(
            project_id=proj.id, key=key, title=title,
            scope=_text(data.get("scope"), "scope", 20000),
            acceptance=_text(data.get("acceptance"), "acceptance", 20000),
            priority=priority, owner=owner,
            labels=_list(data.get("labels"), "labels"), depends_on=[d.upper() for d in depends],
            resources=_clean_resources(db, proj.id, data.get("resources")),
            status="todo", rank=_next_rank(db, proj.id, "todo"), reopened=0, created=now, updated=now,
        )
        db.add(row)
        db.flush()
        _event(db, actor, row.id, author, "created", "", None, "todo", now)
        _touch_author(actor, author)
        db.commit()
    return get_ticket(db, actor, key)


EDITABLE = ("title", "scope", "acceptance", "priority", "owner", "labels", "depends_on", "resources", "rank")


def update_ticket(db: Session, actor: Actor, key: str, data: Dict[str, Any]) -> Dict[str, Any]:
    author = _author(actor, data.get("author"))
    row = _ticket(db, actor, key)
    changes: Dict[str, Any] = {}
    for field in EDITABLE:
        if field not in data:
            continue
        value = data[field]
        if field == "priority":
            value = str(value).upper()
            if value not in PRIORITIES:
                raise TrackerError(f"Priority is one of {', '.join(PRIORITIES)}.")
        elif field == "resources":
            value = _clean_resources(db, row.project_id, value)
        elif field in ("labels", "depends_on"):
            value = _list(value, field)
            if field == "depends_on":
                value = [d.upper() for d in value]
        elif field == "rank":
            value = float(value)
        elif field == "title":
            value = _text(value, "title", 200).strip()
            if not value:
                raise TrackerError("A ticket needs a title.")
        else:
            value = _text(value, field, 20000 if field in ("scope", "acceptance") else 80)
        changes[field] = value
    if not changes:
        raise TrackerError("Nothing to change.")
    if set(changes) - {"rank"}:
        _need(actor, "can_edit", "edit tickets")
        _owned(actor, row, "edit")
        only = actor.token.owner_only if actor.token is not None else None
        if only and "owner" in changes and changes["owner"] != only:
            raise TrackerError(f"This token can't hand tickets to another owner than {only}.", 403)
    if "depends_on" in changes:
        for dep in changes["depends_on"]:
            if dep == row.key:
                raise TrackerError("A ticket can't depend on itself.")
            _ticket(db, actor, dep)
    for field, value in changes.items():
        setattr(row, field, value)
    row.updated = time.time()
    if set(changes) - {"rank"}:
        _event(db, actor, row.id, author, "edit", "Changed " + ", ".join(sorted(set(changes) - {"rank"})) + ".")
    _touch_author(actor, author)
    db.commit()
    return get_ticket(db, actor, key)


def move_ticket(db: Session, actor: Actor, key: str, status: str, author: Any, note: str = "",
                rank: Optional[float] = None) -> Dict[str, Any]:
    author = _author(actor, author)
    if status not in STATUSES:
        raise TrackerError(f"Status is one of {', '.join(STATUSES)}.")
    note = _text(note, "note", 20000)
    row = _ticket(db, actor, key)
    old = row.status
    if old == status:
        if rank is not None:
            row.rank = rank
            db.commit()
        return get_ticket(db, actor, key)
    if not actor.is_owner:
        _need(actor, "can_move", "move tickets")
        _owned(actor, row, "move")
        if status not in AGENT_MOVES[old]:
            raise TrackerError(
                f"An agent can't move a ticket from {STATUS_NAMES[old]} to {STATUS_NAMES[status]}; "
                "only the account's owner approves or sends work back.", 403)
        if status == "uat":
            E = models.TrackerEvent
            entered = db.query(func.max(E.ts)).filter(
                E.ticket_id == row.id, E.kind == "status", E.status_to == "testing").scalar() or 0
            verified = db.query(func.count()).select_from(E).filter(
                E.ticket_id == row.id, E.kind == "verification", E.ts >= entered).scalar()
            if not verified:
                raise TrackerError(
                    "Record the verification (a 'verification' event with what was checked and its "
                    "screenshots) before moving to User acceptance.", 409)
    elif old == "uat" and status not in ("done", "uat") and not note.strip():
        raise TrackerError("Say what must change when sending work back, so the owner can act on it.")
    backwards = STATUSES.index(status) < STATUSES.index(old)
    if actor.is_owner and backwards and old in ("uat", "done"):
        row.reopened = 1
    elif not actor.is_owner:
        row.reopened = 0
    row.status = status
    row.rank = rank if rank is not None else _next_rank(db, row.project_id, status)
    row.updated = time.time()
    _event(db, actor, row.id, author, "status", note, old, status)
    _touch_author(actor, author)
    db.commit()
    return get_ticket(db, actor, key)


def _attachment_dir(user_id: int) -> Path:
    path = config.data_dir() / "files" / "tracker" / str(user_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def add_event(db: Session, actor: Actor, user_id: int, key: str, author: Any, kind: str, body: str,
              files: Optional[List[Tuple[str, Optional[str], bytes]]] = None) -> Dict[str, Any]:
    """A note, comment or verification, with any attached files (name, mime, bytes)."""
    author = _author(actor, author)
    if kind not in ("comment", "note", "verification"):
        raise TrackerError("An event is a comment, note or verification.")
    body = _text(body, "body", 50000)
    files = files or []
    if not body.strip() and not files:
        raise TrackerError("An event needs text or a file.")
    if kind == "verification" and not body.strip():
        raise TrackerError("A verification says what was checked and what was seen.")
    row = _ticket(db, actor, key)
    _need(actor, "can_comment", "add notes, comments or files")
    if kind != "comment":
        _owned(actor, row, "add notes or verification to")
    for name, _mime, data in files:
        if len(data) > MAX_ATTACHMENT_BYTES:
            raise TrackerError(f"{name} is over {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB.", 413)
    ev = _event(db, actor, row.id, author, kind, body)
    folder = _attachment_dir(user_id)
    for name, mime, data in files:
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(name or "file").name)[:120] or "file"
        att_id = uuid.uuid4().hex
        (folder / f"{att_id}_{safe}").write_bytes(data)
        db.add(models.TrackerAttachment(
            id=att_id, event_id=ev.id, ticket_id=row.id, filename=safe,
            # curl sends octet-stream for anything it doesn't know (an .mp4): the name says more; an audio or
            # video type is believed only when the name agrees, since those are served unsandboxed
            mime=recorded_mime(safe, mime),
            size=len(data), storage_path=f"tracker/{user_id}/{att_id}_{safe}",
        ))
    if not actor.is_owner and row.reopened and row.status not in ("uat", "done"):
        row.reopened = 0
    row.updated = time.time()
    _touch_author(actor, author)
    db.commit()
    return get_ticket(db, actor, key)


def attachment(db: Session, actor: Actor, att_id: str) -> Tuple[Path, str, str]:
    row = db.get(models.TrackerAttachment, att_id)
    if row is not None and actor.token is not None:
        ticket = db.get(models.TrackerTicket, row.ticket_id)
        if ticket is None or ticket.project_id != actor.token.project_id:
            row = None
    if row is None:
        raise TrackerError("No such attachment.", 404)
    return config.data_dir() / "files" / row.storage_path, row.mime, row.filename


def get_ticket(db: Session, actor: Actor, key: str) -> Dict[str, Any]:
    row = _ticket(db, actor, key)
    out = _summary(db, row)
    project = db.get(models.TrackerProject, row.project_id)
    out["project"] = {"key": project.key, "name": project.name}
    atts: Dict[int, List[Dict[str, Any]]] = {}
    A, E, T = models.TrackerAttachment, models.TrackerEvent, models.TrackerTicket
    for a in db.query(A).filter(A.ticket_id == row.id).order_by(A.event_id).all():
        atts.setdefault(a.event_id, []).append({
            "id": a.id, "filename": a.filename, "mime": a.mime, "size": a.size,
            "url": f"/api/tracker/attachments/{a.id}",
        })
    out["events"] = [
        {
            "id": e.id, "ts": e.ts, "author": e.author, "kind": e.kind, "body": e.body,
            "status_from": e.status_from, "status_to": e.status_to, "token": e.token_name,
            "attachments": atts.get(e.id, []),
        }
        for e in db.query(E).filter(E.ticket_id == row.id).order_by(E.ts, E.id).all()
    ]
    siblings = db.query(T.key, T.title, T.status, T.depends_on).filter(T.project_id == row.project_id).all()
    by_key = {s.key: s for s in siblings}
    out["blocks"] = [{"key": s.key, "title": s.title, "status": s.status}
                     for s in siblings if row.key in (s.depends_on or [])]
    out["dependencies"] = [{"key": by_key[d].key, "title": by_key[d].title, "status": by_key[d].status}
                           for d in out["depends_on"] if d in by_key]
    names = {k: r.name for k, r in _resource_keys(db, row.project_id).items()}
    out["waiting_for"] = _waits(row, _holders(db, row.project_id), names)
    return out


def changes_since(db: Session, actor: Actor, project: str, since: float) -> List[Dict[str, Any]]:
    """Events in a project after ``since`` (unix seconds), newest last."""
    proj = _project(db, actor, project)
    E, T = models.TrackerEvent, models.TrackerTicket
    rows = (
        db.query(E, T.key).join(T, T.id == E.ticket_id)
        .filter(T.project_id == proj.id, E.ts > since).order_by(E.ts, E.id).limit(500).all()
    )
    return [
        {"ticket": key, "ts": e.ts, "author": e.author, "kind": e.kind, "body": e.body,
         "status_from": e.status_from, "status_to": e.status_to, "token": e.token_name}
        for e, key in rows
    ]


# ---------------------------------------------------------------- picking work
# Owner = the agent doing it, labels = the kind of work. Any idle agent asks for the next startable
# to-do and claims it; a claim sets the owner and moves it to in_progress in one step.

PRIORITY_ORDER = {p: i for i, p in enumerate(PRIORITIES)}


def _not_startable(t: models.TrackerTicket, author: str, by_key: Dict[str, models.TrackerTicket],
                   holders: Dict[str, List[Dict[str, Any]]], names: Dict[str, str]) -> List[str]:
    """Why a to-do can't be started by `author` right now ([] = startable)."""
    reasons = []
    for d in t.depends_on or []:
        dep = by_key.get(d)
        if dep is not None and dep.status != "done":
            reasons.append(f"waiting on {d} ({STATUS_NAMES.get(dep.status, dep.status)})")
    for label in t.labels or []:
        if str(label).startswith("blocked:"):
            reasons.append(f"{label}: waits on a decision (see its scope)")
    for k in t.resources or []:
        held = [h["ticket"] for h in holders.get(k, []) if h["ticket"] != t.key]
        if held:
            reasons.append(f"machine {names.get(k, k)} held by {', '.join(held)}")
    # A to-do in a chain another agent is building stays with that agent
    if t.owner and t.owner != author:
        chain = [d for d in (t.depends_on or []) if by_key.get(d) is not None and by_key[d].owner == t.owner]
        if chain:
            reasons.append(f"part of {t.owner}'s chain (after {', '.join(chain)})")
    return reasons


def next_tickets(db: Session, actor: Actor, project: str, author: Any) -> Dict[str, Any]:
    author = _author(actor, author) if not actor.is_owner else str(author or "").strip()
    return _next_for(db, _project(db, actor, project), author)


def _next_for(db: Session, proj: models.TrackerProject, author: str) -> Dict[str, Any]:
    T = models.TrackerTicket
    tickets = db.query(T).filter(T.project_id == proj.id).all()
    by_key = {t.key: t for t in tickets}
    holders = _holders(db, proj.id)
    names = {k: r.name for k, r in _resource_keys(db, proj.id).items()}
    todo = sorted((t for t in tickets if t.status == "todo"), key=lambda t: (PRIORITY_ORDER.get(t.priority, 9), t.rank, t.id))
    startable, waiting = [], []
    for t in todo:
        reasons = _not_startable(t, author, by_key, holders, names)
        brief = {"key": t.key, "title": t.title, "priority": t.priority, "owner": t.owner, "labels": list(t.labels or []),
                 "resources": list(t.resources or []), "depends_on": list(t.depends_on or [])}
        if reasons:
            waiting.append({**brief, "reasons": reasons})
        else:
            startable.append(brief)
    return {"author": author, "startable": startable, "not_startable": waiting}


def claim_ticket(db: Session, actor: Actor, key: str, author: Any) -> Dict[str, Any]:
    """Take a startable to-do: owner := author and status := in_progress, atomically.
    Refused (409, with the reason) if someone else got it first or it isn't startable."""
    if actor.is_owner:
        raise TrackerError("Claiming is for agents: they name themselves as the ticket's owner.", 403)
    author = _author(actor, author)
    _need(actor, "can_move", "claim tickets")
    _need(actor, "can_edit", "claim tickets")
    only = actor.token.owner_only if actor.token is not None else None
    if only and author != only:
        raise TrackerError(f"This token claims tickets for {only} only.", 403)
    with _lock:
        row = _ticket(db, actor, key)
        db.refresh(row)
        if row.status != "todo":
            who = f" by {row.owner}" if row.owner else ""
            raise TrackerError(f"{row.key} is already {STATUS_NAMES.get(row.status, row.status)}{who}; ask for the next one.", 409)
        T = models.TrackerTicket
        siblings = db.query(T).filter(T.project_id == row.project_id).all()
        reasons = _not_startable(row, author, {t.key: t for t in siblings}, _holders(db, row.project_id),
                                 {k: r.name for k, r in _resource_keys(db, row.project_id).items()})
        if reasons:
            raise TrackerError(f"{row.key} can't be started: " + "; ".join(reasons) + ".", 409)
        # The status check is in the UPDATE itself, so a racing claim can't also win
        won = db.query(T).filter(T.id == row.id, T.status == "todo").update(
            {T.owner: author, T.status: "in_progress", T.rank: _next_rank(db, row.project_id, "in_progress"),
             T.updated: time.time(), T.reopened: 0}, synchronize_session=False)
        if not won:
            db.rollback()
            raise TrackerError(f"{row.key} was just claimed by someone else; ask for the next one.", 409)
        _event(db, actor, row.id, author, "status", f"Claimed by {author}.", "todo", "in_progress")
        _touch_author(actor, author)
        db.commit()
    return get_ticket(db, actor, key)


def project_agents(db: Session, actor: Actor, project: str) -> Dict[str, Any]:
    """Who is working on what: every agent name in the project's history with its current
    tickets, last activity and whether it's idle; how many startable tickets nobody has claimed; and
    what waits on the user (tickets to review and agents' open questions), and blocked:user tickets whose
    agent hasn't asked its question yet."""
    proj = _project(db, actor, project)
    T, E = models.TrackerTicket, models.TrackerEvent
    tickets = db.query(T).filter(T.project_id == proj.id).all()
    by_id = {t.id: t for t in tickets}
    events = db.query(E).filter(E.ticket_id.in_(list(by_id) or [-1])).order_by(E.ts).all()
    names: Dict[str, Dict[str, Any]] = {}
    for e in events:
        if e.author == USER:
            continue
        a = names.setdefault(e.author, {"name": e.author, "current": [], "in_review": [], "last_activity": None})
        t = by_id[e.ticket_id]
        what = (f"moved {STATUS_NAMES.get(e.status_from or '', e.status_from)} → {STATUS_NAMES.get(e.status_to or '', e.status_to)}"
                if e.kind == "status" else e.kind)
        a["last_activity"] = {"ticket": t.key, "title": t.title, "what": what, "ts": e.ts}
    for t in tickets:
        if t.owner and t.owner != USER and t.owner not in names and t.status != "done":
            names[t.owner] = {"name": t.owner, "current": [], "in_review": [], "last_activity": None}
        a = names.get(t.owner)
        if a is None:
            continue
        brief = {"key": t.key, "title": t.title, "status": t.status, "priority": t.priority, "updated": t.updated,
                 "resources": list(t.resources or [])}
        if t.status in ACTIVE:
            a["current"].append(brief)
        elif t.status == "uat":
            a["in_review"].append(brief)
    agents = []
    for a in names.values():
        a["current"].sort(key=lambda x: -x["updated"])
        a["idle"] = not a["current"]
        agents.append(a)
    agents.sort(key=lambda a: (a["idle"], -((a["last_activity"] or {}).get("ts") or 0)))
    nxt = _next_for(db, proj, "")
    unclaimed = [x for x in nxt["startable"] if not x["owner"]]
    review = [t for t in tickets if t.status == "uat"]
    Q = models.TrackerQuestion
    open_on = {i for (i,) in db.query(Q.ticket_id).filter(Q.project_id == proj.id, Q.status == "open")}
    active_on = {i for (i,) in db.query(Q.ticket_id).filter(Q.project_id == proj.id, Q.status.in_(QUESTION_ACTIVE))}
    asked = [t for t in tickets if t.id in open_on]
    unasked = [t for t in tickets if t.status != "done" and _blocked_on_user(t) and t.id not in active_on]
    return {
        "agents": agents,
        "startable_unclaimed": [{"key": x["key"], "title": x["title"], "priority": x["priority"]} for x in unclaimed],
        "waiting_on_user": {
            "count": len({t.key for t in review} | {t.key for t in asked}),
            "review": [{"key": t.key, "title": t.title, "owner": t.owner} for t in review],
            "asked": [{"key": t.key, "title": t.title, "status": t.status, "owner": t.owner} for t in asked],
            "unasked": [{"key": t.key, "title": t.title, "status": t.status, "owner": t.owner} for t in unasked],
            "decisions": [],   # kept empty for clients that read it
        },
    }


# ---------------------------------------------------------------- waiting on you, stale work

def _clip(text: str, n: int = 280) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _blocked_on_user(t: models.TrackerTicket) -> bool:
    return any(str(l) == "blocked:user" for l in (t.labels or []))


def _entered(db: Session, t: models.TrackerTicket, status: str) -> float:
    E = models.TrackerEvent
    ts = (db.query(func.max(E.ts)).filter(E.ticket_id == t.id, E.kind == "status", E.status_to == status).scalar())
    return ts or t.updated


def waiting_on_you(db: Session, actor: Actor, project: str) -> Dict[str, Any]:
    """What waits for the owner, asked properly: agents' questions on tickets (waiting
    longest first) and work to review (User acceptance, waiting longest first). Nothing is guessed any more: a
    blocked:user ticket whose agent hasn't asked its question yet is listed apart (`unasked`, not counted) with a
    nudge for its owner to ask; chat messages are never read as questions."""
    proj = _project(db, actor, project)
    T, Q = models.TrackerTicket, models.TrackerQuestion
    tickets = db.query(T).filter(T.project_id == proj.id, T.status != "done").all()
    now = time.time()
    by_id = {t.id: t for t in tickets}
    open_q = db.query(Q).filter(Q.project_id == proj.id, Q.status == "open").order_by(Q.waiting_since).all()
    asked = [_question_out(db, q, by_id.get(q.ticket_id) or db.get(T, q.ticket_id)) for q in open_q]
    # Tickets with a question going (open, or answered and waiting for the agent): not 'unasked'
    with_question = {t for (t,) in db.query(Q.ticket_id).filter(Q.project_id == proj.id, Q.status.in_(QUESTION_ACTIVE))}
    unasked = sorted(({"key": t.key, "title": t.title, "status": t.status, "owner": t.owner, "priority": t.priority,
                       "since": t.updated} for t in tickets if _blocked_on_user(t) and t.id not in with_question),
                     key=lambda u: (u["priority"], u["since"]))
    review = []
    for t in tickets:
        if t.status != "uat":
            continue
        since = _entered(db, t, "uat")
        review.append({"key": t.key, "title": t.title, "owner": t.owner, "priority": t.priority,
                       "since": since, "waiting_hours": round((now - since) / 3600, 1)})
    review.sort(key=lambda r: r["since"])
    return {"count": len(asked) + len(review), "asked": asked, "review": review, "unasked": unasked,
            # never guessed from scopes or the chat (kept, empty, for clients that read it)
            "decisions": [], "questions": []}


STALE_DEFAULT = 35


def stale_work(db: Session, actor: Actor, project: str, minutes: Any = STALE_DEFAULT) -> Dict[str, Any]:
    """In progress and testing tickets whose owner hasn't posted within `minutes`: on the
    ticket (any event) or in the project chat naming it. For a coordinator's rounds, instead of
    fetching every ticket and its history."""
    proj = _project(db, actor, project)
    if not actor.is_owner:
        _need(actor, "can_comment", "read stale work")
    try:
        minutes = max(5, min(int(minutes), 7 * 24 * 60))
    except (TypeError, ValueError, OverflowError):
        raise TrackerError("minutes is a whole number.")
    T, E, M = models.TrackerTicket, models.TrackerEvent, models.TrackerMessage
    now = time.time()
    active = db.query(T).filter(T.project_id == proj.id, T.status.in_(ACTIVE)).all()
    chat = db.query(M).filter(M.project_id == proj.id, M.author.notin_((USER, TRACKER)), M.ts >= now - 7 * 86400).all()
    out = []
    for t in active:
        owner = (t.owner or "").lower()
        last = None
        kind = None
        if owner:
            ev = (db.query(E).filter(E.ticket_id == t.id, func.lower(E.author) == owner)
                  .order_by(E.ts.desc()).first())
            if ev:
                last, kind = ev.ts, ev.kind
            for m in chat:
                if m.author.lower() == owner and t.key in (m.tickets or []) and (last is None or m.ts > last):
                    last, kind = m.ts, "chat"
        since_active = None
        for mv in db.query(E).filter(E.ticket_id == t.id, E.kind == "status").order_by(E.ts):
            if mv.status_to in ACTIVE and mv.status_from not in ACTIVE:
                since_active = mv.ts
        quiet = (now - (last or since_active or t.updated)) / 60
        if quiet < minutes:
            continue
        out.append({"key": t.key, "title": t.title, "status": t.status, "owner": t.owner, "priority": t.priority,
                    "last_post": last, "last_post_kind": kind, "minutes_quiet": int(quiet),
                    "active_since": since_active, "holds": list(t.resources or [])})
    out.sort(key=lambda x: -x["minutes_quiet"])
    return {"minutes": minutes, "now": now, "stale": out}


# ---------------------------------------------------------------- shared machines

def _resource_out(r: models.TrackerResource, holders: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
    held = holders.get(r.key, [])
    return {"key": r.key, "name": r.name, "description": r.description, "busy": bool(held), "holders": held}


def list_resources(db: Session, actor: Actor, project: str) -> List[Dict[str, Any]]:
    proj = _project(db, actor, project)
    holders = _holders(db, proj.id)
    return [_resource_out(r, holders) for r in sorted(_resource_keys(db, proj.id).values(), key=lambda r: r.name.lower())]


def _may_edit_resources(actor: Actor) -> None:
    if not actor.is_owner:
        _need(actor, "can_edit", "edit the project's machines")


def create_resource(db: Session, actor: Actor, project: str, data: Dict[str, Any]) -> Dict[str, Any]:
    _may_edit_resources(actor)
    proj = _project(db, actor, project)
    key = str(data.get("key") or "").strip().lower()
    if not _RESOURCE_RE.match(key):
        raise TrackerError("A machine key is lower-case letters, digits and dashes (e.g. gpu-box).")
    name = _text(data.get("name"), "name", 80).strip() or key
    if key in _resource_keys(db, proj.id):
        raise TrackerError(f"{proj.key} already has a machine {key}.", 409)
    r = models.TrackerResource(project_id=proj.id, key=key, name=name,
                               description=_text(data.get("description"), "description", 2000), created=time.time())
    db.add(r)
    db.commit()
    return _resource_out(r, _holders(db, proj.id))


def update_resource(db: Session, actor: Actor, project: str, key: str, data: Dict[str, Any]) -> Dict[str, Any]:
    _may_edit_resources(actor)
    proj = _project(db, actor, project)
    r = _resource_keys(db, proj.id).get(str(key).lower())
    if r is None:
        raise TrackerError(f"No machine {key}.", 404)
    if "name" in data:
        r.name = _text(data["name"], "name", 80).strip() or r.key
    if "description" in data:
        r.description = _text(data["description"], "description", 2000)
    db.commit()
    return _resource_out(r, _holders(db, proj.id))


def delete_resource(db: Session, actor: Actor, project: str, key: str) -> None:
    _may_edit_resources(actor)
    proj = _project(db, actor, project)
    r = _resource_keys(db, proj.id).get(str(key).lower())
    if r is None:
        raise TrackerError(f"No machine {key}.", 404)
    T = models.TrackerTicket
    using = [t.key for t in db.query(T).filter(T.project_id == proj.id).all() if r.key in (t.resources or [])]
    if using:
        raise TrackerError(f"{', '.join(using[:8])} still need {r.key}; take it off them first.", 409)
    db.delete(r)
    db.commit()


def _owner_only(actor: Actor) -> None:
    if not actor.is_owner:
        raise TrackerError("Only the account's owner, signed in, manages access tokens.", 403)


def list_tokens(db: Session, actor: Actor, project: str) -> List[Dict[str, Any]]:
    _owner_only(actor)
    proj = _project(db, actor, project)
    K = models.TrackerToken
    rows = db.query(K).filter(K.project_id == proj.id, K.revoked_at.is_(None)).order_by(K.id.desc()).all()
    return [token_info(db, r) for r in rows]


def create_token(db: Session, actor: Actor, project: str, data: Dict[str, Any]) -> Tuple[Dict[str, Any], str]:
    _owner_only(actor)
    proj = _project(db, actor, project)
    name = _text(data.get("name"), "name", 100).strip()
    if not name:
        raise TrackerError("A token needs a name, so you can tell it apart later.")
    owner_only = _text(data.get("owner_only"), "owner_only", 80).strip() or None
    days = data.get("expires_in_days")
    if days is not None:
        try:
            days = int(days)
        except (TypeError, ValueError):
            raise TrackerError("expires_in_days is a whole number of days.")
        if days < 1 or days > 3650:
            raise TrackerError("expires_in_days is between 1 and 3650.")
    token = auth.TRACKER_TOKEN_PREFIX + __import__("secrets").token_urlsafe(32)
    row = models.TrackerToken(
        project_id=proj.id, name=name, prefix=token[:12], token_hash=auth.hash_token(token),
        can_create=bool(data.get("can_create", True)), can_edit=bool(data.get("can_edit", True)),
        can_move=bool(data.get("can_move", True)), can_comment=bool(data.get("can_comment", True)),
        owner_only=owner_only,
        expires_at=(auth.utcnow() + timedelta(days=days)) if days else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return token_info(db, row), token


def revoke_token(db: Session, actor: Actor, token_id: int) -> None:
    _owner_only(actor)
    row = db.get(models.TrackerToken, token_id)
    if row is None or row.revoked_at is not None:
        raise TrackerError("No such token.", 404)
    row.revoked_at = auth.utcnow()
    db.commit()
    auth.invalidate_tracker_token(row.id)


# ---------------------------------------------------------------- project chat
# One running conversation per project between the owner and the agents, so the owner can talk to
# them from a phone. Agents post short updates and answers; at the start of each turn an agent asks
# for its unread messages (the owner's, addressed to it or to everyone) like attention=true.

CHAT_BODY_LIMIT = 20000
CHAT_PAGE = 100
_MENTION_RE = re.compile(r"^\s*@([A-Za-z0-9][A-Za-z0-9_.-]{0,79})\b")
_TICKET_KEY_RE = re.compile(r"\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b")


def _chat_tickets(db: Session, proj: models.TrackerProject, given: Any, body: str) -> List[str]:
    """The keys to show as cards: those given, then those the text names, in this project only."""
    wanted = [k.upper() for k in _list(given, "tickets")] + _TICKET_KEY_RE.findall(body)
    wanted = list(dict.fromkeys(wanted))[:50]
    if not wanted:
        return []
    T = models.TrackerTicket
    real = {k for (k,) in db.query(T.key).filter(T.project_id == proj.id, T.key.in_(wanted)).all()}
    return [k for k in wanted if k in real][:12]


def _message_out(m: models.TrackerMessage, ticket_rows: Dict[str, models.TrackerTicket]) -> Dict[str, Any]:
    cards = []
    for k in m.tickets or []:
        t = ticket_rows.get(k)
        if t is not None:
            cards.append({"key": t.key, "title": t.title, "status": t.status, "owner": t.owner, "priority": t.priority})
    return {"id": m.id, "ts": m.ts, "author": m.author, "to": m.to_agent or None, "body": m.body,
            "tickets": cards, "token": m.token_name}


def _messages_out(db: Session, rows: List[models.TrackerMessage]) -> List[Dict[str, Any]]:
    keys = {k for m in rows for k in (m.tickets or [])}
    T = models.TrackerTicket
    tickets = {t.key: t for t in db.query(T).filter(T.key.in_(list(keys)))} if keys else {}
    return [_message_out(m, tickets) for m in rows]


def _read_marker(db: Session, proj: models.TrackerProject, reader: str) -> Optional[models.TrackerChatRead]:
    R = models.TrackerChatRead
    return db.query(R).filter(R.project_id == proj.id, func.lower(R.reader) == reader.lower()).first()


def _set_read(db: Session, proj: models.TrackerProject, reader: str, upto: int) -> int:
    row = _read_marker(db, proj, reader)
    if row is None:
        # Two first posts from a new agent at once both made its marker: the unique constraint
        # failed and the second message was lost with a 500. The loser reads the winner's.
        from sqlalchemy.exc import IntegrityError
        try:
            with db.begin_nested():
                row = models.TrackerChatRead(project_id=proj.id, reader=reader, upto=0, ts=time.time())
                db.add(row)
                db.flush()
        except IntegrityError:
            row = _read_marker(db, proj, reader)
    if upto > (row.upto or 0):
        row.upto = upto
        row.ts = time.time()
    return row.upto


def chat_messages(db: Session, actor: Actor, project: str, since: Optional[int] = None,
                  before: Optional[int] = None, limit: int = CHAT_PAGE) -> Dict[str, Any]:
    """The chat, newest last: after ``since`` (a message id), else the latest page (older pages with
    ``before``)."""
    proj = _project(db, actor, project)
    M = models.TrackerMessage
    limit = max(1, min(int(limit or CHAT_PAGE), 500))
    q = db.query(M).filter(M.project_id == proj.id)
    if since is not None:
        rows = q.filter(M.id > since).order_by(M.id).limit(limit).all()
    else:
        if before is not None:
            q = q.filter(M.id < before)
        rows = list(reversed(q.order_by(M.id.desc()).limit(limit).all()))
    more = bool(rows) and since is None and db.query(M.id).filter(M.project_id == proj.id, M.id < rows[0].id).first() is not None
    return {"messages": _messages_out(db, rows), "more_before": more}


def post_message(db: Session, actor: Actor, project: str, data: Dict[str, Any]) -> Dict[str, Any]:
    author = _author(actor, data.get("author"))
    if not actor.is_owner:
        _as_own_agent(actor, author)
    proj = _project(db, actor, project)
    _need(actor, "can_comment", "post in the project chat")
    body = _text(data.get("body"), "body", CHAT_BODY_LIMIT).strip()
    if not body:
        raise TrackerError("A message needs text.")
    to = _text(data.get("to"), "to", 81).strip().lstrip("@") or None
    if to is None:
        mention = _MENTION_RE.match(body)
        to = mention.group(1) if mention else None
    if to and to.lower() in ("all", "everyone"):
        to = None
    if to and to.lower() == USER:
        to = USER
    msg = models.TrackerMessage(
        project_id=proj.id, ts=time.time(), author=author, to_agent=to, body=body,
        tickets=_chat_tickets(db, proj, data.get("tickets"), body) or None,
        token_id=actor.token.id if actor.token else None, token_name=actor.token_name,
    )
    db.add(msg)
    db.flush()
    _set_read(db, proj, author, msg.id)  # you've read what you replied to
    _touch_author(actor, author)
    db.commit()
    return _messages_out(db, [msg])[0]


def _unread_query(db: Session, proj: models.TrackerProject, reader: str):
    M = models.TrackerMessage
    marker = _read_marker(db, proj, reader)
    upto = marker.upto if marker else 0
    q = db.query(M).filter(M.project_id == proj.id, M.id > upto)
    if reader == USER:
        return q.filter(M.author.notin_((USER, TRACKER)))  # the agents' messages, not the Tracker's own
    # An agent: the owner's messages to it or to everyone, after its own last post, and the Tracker's to it
    last_own = db.query(func.max(M.id)).filter(M.project_id == proj.id, func.lower(M.author) == reader.lower()).scalar() or 0
    from_owner = (M.author == USER) & ((M.to_agent.is_(None)) | (M.to_agent == "") | (func.lower(M.to_agent) == reader.lower()))
    from_tracker = (M.author == TRACKER) & (func.lower(M.to_agent) == reader.lower())
    return q.filter(M.id > last_own, from_owner | from_tracker)


def _reader(actor: Actor, value: Any) -> str:
    """Whose unread messages: an agent names itself; the owner reads as 'user' unless it names an agent."""
    name = str(value or "").strip()
    if actor.is_owner:
        return name if name and name.lower() != USER else USER
    return _author(actor, name)


def chat_unread(db: Session, actor: Actor, project: str, reader: Any) -> Dict[str, Any]:
    proj = _project(db, actor, project)
    who = _reader(actor, reader)
    rows = _unread_query(db, proj, who).order_by(models.TrackerMessage.id).limit(200).all()
    out = {"for": who, "count": len(rows), "messages": _messages_out(db, rows),
           "upto": rows[-1].id if rows else None}
    if who != USER:
        # the reader's questions the user has answered and it hasn't acted on yet (replied or closed)
        Q = models.TrackerQuestion
        out["questions_answered"] = (db.query(func.count(Q.id)).filter(Q.project_id == proj.id, Q.status == "answered",
                                                                        func.lower(Q.asked_by) == who.lower()).scalar() or 0)
    return out


def _as_own_agent(actor: Actor, author: str) -> None:
    """A token limited to one agent speaks and reads only as that agent: another name could post
    as someone else or mark the owner's messages to them read, so they'd never see them."""
    only = actor.token.owner_only if actor.token is not None else None
    if only and author.lower() != only.lower():
        raise TrackerError(f"This token speaks for {only} only.", 403)


def chat_mark_read(db: Session, actor: Actor, project: str, reader: Any, upto: Any = None) -> Dict[str, Any]:
    """Move a reader's marker forward (never back): to ``upto``, or to the latest message."""
    proj = _project(db, actor, project)
    who = USER if actor.is_owner else _author(actor, reader)
    if not actor.is_owner:
        _need(actor, "can_comment", "mark the project chat read")  # it changes what others see
        _as_own_agent(actor, who)
    M = models.TrackerMessage
    latest = db.query(func.max(M.id)).filter(M.project_id == proj.id).scalar() or 0
    if upto is None:
        target = latest
    else:
        if isinstance(upto, bool) or not isinstance(upto, (int, str)):
            raise TrackerError("upto is a message id.")  # Infinity / NaN in JSON gave a 500
        try:
            target = min(int(upto), latest)
        except (TypeError, ValueError, OverflowError):
            raise TrackerError("upto is a message id.")
    done = _set_read(db, proj, who, target)
    db.commit()
    return {"for": who, "upto": done, "unread": _unread_query(db, proj, who).count()}


# ---------------------------------------------------------------- questions
# An agent asks the owner a question on a ticket: context, options, its recommendation. The owner answers
# (picking an option and/or writing), either side replies in the thread, and the asking agent resolves or
# withdraws it. open = waiting for the owner; answered = the owner replied last.

QUESTION_STATUSES = ("open", "answered", "resolved", "withdrawn")
QUESTION_ACTIVE = ("open", "answered")
QUESTION_TITLE_LIMIT = 200
QUESTION_BODY_LIMIT = 20000
QUESTION_OPTIONS = 6


def _question(db: Session, actor: Actor, question_id: Any) -> Tuple[models.TrackerQuestion, models.TrackerTicket]:
    try:
        qid = int(question_id)
    except (TypeError, ValueError, OverflowError):
        raise TrackerError("No such question.", 404)
    q = db.get(models.TrackerQuestion, qid)
    ticket = db.get(models.TrackerTicket, q.ticket_id) if q is not None else None
    if q is None or ticket is None or (actor.token is not None and actor.token.project_id != q.project_id):
        raise TrackerError("No such question.", 404)
    return q, ticket


def _options(value: Any) -> List[Dict[str, str]]:
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise TrackerError("options is a list of {label, detail}.")
    if len(value) > QUESTION_OPTIONS:
        raise TrackerError(f"A question offers at most {QUESTION_OPTIONS} options.")
    out: List[Dict[str, str]] = []
    for item in value:
        if isinstance(item, str):
            item = {"label": item}
        if not isinstance(item, dict):
            raise TrackerError("Each option is {label, detail}.")
        label = _text(item.get("label"), "An option's label", 120).strip()
        if not label:
            raise TrackerError("Each option needs a label.")
        if any(o["label"].lower() == label.lower() for o in out):
            raise TrackerError(f"Two options are called {label}.")
        out.append({"label": label, "detail": _text(item.get("detail"), "An option's detail", 2000).strip()})
    return out


def _option_label(q: models.TrackerQuestion, value: Any) -> Optional[str]:
    """The option ``value`` names (any case), or None for no choice; an unknown one is refused."""
    if value in (None, ""):
        return None
    text = str(value).strip().lower()
    for o in q.options or []:
        if o.get("label", "").lower() == text:
            return o["label"]
    raise TrackerError("That isn't one of the question's options.")


def _reply_out(r: models.TrackerQuestionReply) -> Dict[str, Any]:
    return {"id": r.id, "ts": r.ts, "author": r.author, "body": r.body, "choice": r.choice, "token": r.token_name}


def _question_out(db: Session, q: models.TrackerQuestion, ticket: models.TrackerTicket,
                  replies: Optional[List[models.TrackerQuestionReply]] = None) -> Dict[str, Any]:
    R = models.TrackerQuestionReply
    out = {
        "id": q.id, "ticket": {"key": ticket.key, "title": ticket.title, "status": ticket.status, "owner": ticket.owner},
        "asked_by": q.asked_by, "title": q.title, "body": q.body, "options": list(q.options or []),
        "recommended": q.recommended, "status": q.status, "created": q.created, "updated": q.updated,
        "waiting_since": q.waiting_since, "answered_at": q.answered_at, "closed_at": q.closed_at,
        "closed_by": q.closed_by, "token": q.token_name,
    }
    if replies is not None:
        out["replies"] = [_reply_out(r) for r in replies]
        last = replies[-1] if replies else None
        out["reply_count"] = len(replies)
    else:
        out["reply_count"] = db.query(func.count(R.id)).filter(R.question_id == q.id).scalar() or 0
        last = db.query(R).filter(R.question_id == q.id).order_by(R.id.desc()).first()
    out["last_reply"] = ({"author": last.author, "ts": last.ts, "choice": last.choice, "preview": _clip(last.body or "", 200)}
                         if last is not None else None)
    # The owner's latest pick, so a card can show it without the thread
    chosen = next((r.choice for r in reversed(replies) if r.author == USER and r.choice), None) if replies is not None else (
        db.query(R.choice).filter(R.question_id == q.id, R.author == USER, R.choice.isnot(None)).order_by(R.id.desc()).limit(1).scalar())
    out["chosen"] = chosen
    return out


def _question_counts(db: Session, ticket_id: int) -> Dict[str, int]:
    Q = models.TrackerQuestion
    rows = db.query(Q.status, func.count()).filter(Q.ticket_id == ticket_id, Q.status.in_(QUESTION_ACTIVE)).group_by(Q.status).all()
    got = {s: n for s, n in rows}
    return {"open": got.get("open", 0), "answered": got.get("answered", 0)}


def ask_question(db: Session, actor: Actor, key: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """An agent asks the owner a question on a ticket."""
    if actor.is_owner:
        raise TrackerError("Questions are asked by agents; comment on the ticket instead.")
    author = _author(actor, data.get("author"))
    _as_own_agent(actor, author)
    ticket = _ticket(db, actor, key)
    _need(actor, "can_comment", "ask questions")
    _owned(actor, ticket, "ask questions on")
    title = _text(data.get("title"), "title", QUESTION_TITLE_LIMIT).strip()
    if not title:
        raise TrackerError("A question needs a title: the question in one line.")
    body = _text(data.get("body"), "body", QUESTION_BODY_LIMIT).strip()
    options = _options(data.get("options"))
    recommended = None
    if data.get("recommended") not in (None, ""):
        want = str(data.get("recommended")).strip().lower()
        recommended = next((o["label"] for o in options if o["label"].lower() == want), None)
        if recommended is None:
            raise TrackerError("recommended names one of the options.")
    now = time.time()
    q = models.TrackerQuestion(
        project_id=ticket.project_id, ticket_id=ticket.id, asked_by=author, title=title, body=body,
        options=options or None, recommended=recommended, status="open", created=now, updated=now, waiting_since=now,
        token_id=actor.token.id if actor.token else None, token_name=actor.token_name,
    )
    db.add(q)
    db.flush()
    _event(db, actor, ticket.id, author, "note", f"Asked the user: **{title}** (question {q.id})", ts=now)
    ticket.updated = now
    _touch_author(actor, author)
    db.commit()
    return _question_out(db, q, ticket, [])


def list_questions(db: Session, actor: Actor, project: str, status: Optional[str] = None,
                   asked_by: Optional[str] = None, ticket: Optional[str] = None, limit: Any = 200) -> Dict[str, Any]:
    """A project's questions: open ones first (waiting longest first), then answered (newest answer first),
    then closed (newest first). ``status``: a status, several comma-separated, 'active' (open and
    answered) or 'closed' (resolved and withdrawn)."""
    proj = _project(db, actor, project)
    Q = models.TrackerQuestion
    query = db.query(Q).filter(Q.project_id == proj.id)
    if status:
        wanted: List[str] = []
        for part in str(status).lower().split(","):
            part = part.strip()
            if part == "active":
                wanted += list(QUESTION_ACTIVE)
            elif part == "closed":
                wanted += ["resolved", "withdrawn"]
            elif part in QUESTION_STATUSES:
                wanted.append(part)
            elif part:
                raise TrackerError("status is open, answered, resolved, withdrawn, active or closed.")
        if wanted:
            query = query.filter(Q.status.in_(wanted))
    if asked_by:
        query = query.filter(func.lower(Q.asked_by) == str(asked_by).strip().lower())
    if ticket:
        t = _ticket(db, actor, ticket)
        query = query.filter(Q.ticket_id == t.id)
    try:
        n = max(1, min(int(limit), 500))
    except (TypeError, ValueError, OverflowError):
        n = 200
    rank = {"open": 0, "answered": 1, "resolved": 2, "withdrawn": 2}
    rows = query.all()
    rows.sort(key=lambda q: (rank.get(q.status, 3), q.waiting_since if q.status == "open"
                             else -(q.answered_at or q.updated) if q.status == "answered" else -(q.closed_at or q.updated)))
    rows = rows[:n]
    tickets = {t.id: t for t in db.query(models.TrackerTicket).filter(models.TrackerTicket.id.in_({q.ticket_id for q in rows}))} if rows else {}
    counts = dict(db.query(Q.status, func.count()).filter(Q.project_id == proj.id, Q.status.in_(QUESTION_ACTIVE)).group_by(Q.status).all())
    return {"questions": [_question_out(db, q, tickets[q.ticket_id]) for q in rows if q.ticket_id in tickets],
            "open": counts.get("open", 0), "answered": counts.get("answered", 0)}


def get_question(db: Session, actor: Actor, question_id: Any) -> Dict[str, Any]:
    q, ticket = _question(db, actor, question_id)
    R = models.TrackerQuestionReply
    replies = db.query(R).filter(R.question_id == q.id).order_by(R.id).all()
    return _question_out(db, q, ticket, replies)


def reply_question(db: Session, actor: Actor, question_id: Any, data: Dict[str, Any]) -> Dict[str, Any]:
    """The owner answers (an option and/or words), or the asking agent replies with more."""
    q, ticket = _question(db, actor, question_id)
    author = _author(actor, data.get("author"))
    if not actor.is_owner:
        _as_own_agent(actor, author)
        _need(actor, "can_comment", "reply to questions")
        if author.lower() != q.asked_by.lower():
            raise TrackerError(f"Only {q.asked_by}, who asked it, or the user replies to this question.", 403)
    if q.status not in QUESTION_ACTIVE:
        raise TrackerError(f"This question is {q.status}.", 409)
    body = _text(data.get("body"), "body", QUESTION_BODY_LIMIT).strip()
    choice = _option_label(q, data.get("choice")) if actor.is_owner else None
    if not actor.is_owner and data.get("choice") not in (None, ""):
        raise TrackerError("Only the user picks an option.", 403)
    if not body and not choice:
        raise TrackerError("A reply needs words or a choice.")
    last = (db.query(models.TrackerQuestionReply).filter(models.TrackerQuestionReply.question_id == q.id)
            .order_by(models.TrackerQuestionReply.ts.desc(), models.TrackerQuestionReply.id.desc()).first())
    if (last is not None and last.author == author and (last.choice or None) == (choice or None)
            and (last.body or "").strip() == body):
        # The same reply sent again (a second tap, a client's resend): nothing new, so no second reply,
        # event or ping (question #21 pinged its asker twice for one answer)
        return get_question(db, actor, q.id)
    again = actor.is_owner and q.status == "answered"  # the user adds to an answer the agent hasn't replied to
    now = time.time()
    db.add(models.TrackerQuestionReply(question_id=q.id, ts=now, author=author, body=body, choice=choice,
                                       token_id=actor.token.id if actor.token else None, token_name=actor.token_name))
    ping: Optional[models.TrackerMessage] = None
    if actor.is_owner:
        q.status = "answered"
        q.answered_at = now
        said = f"Answered question {q.id} (**{q.title}**)" + (f": chose **{choice}**" if choice else "")
        _event(db, actor, ticket.id, author, "comment", said + (f"\n\n{body}" if body else ""), ts=now)
        # a chat message to the asker, so the answer is in /chat/unread, which every agent already reads
        # (agents missed answers that only showed under ?status=answered). Once per owner reply.
        ping = models.TrackerMessage(
            project_id=q.project_id, ts=now, author=TRACKER, to_agent=q.asked_by,
            body=(f"@{q.asked_by} the user {'replied again to' if again else 'answered'} your question #{q.id} on {ticket.key}: {_clip(q.title, 160)}"
                  + (f" (chose {choice})" if choice else "") + f"; read it with GET /questions/{q.id}"),
            tickets=[ticket.key], token_id=None, token_name="Tracker: question answered",
        )
        db.add(ping)
    else:
        q.status = "open"
        q.waiting_since = now
        _touch_author(actor, author)
    q.updated = now
    ticket.updated = now
    db.commit()
    out = get_question(db, actor, q.id)
    if ping is not None:
        out["ping"] = {"id": ping.id, "to": ping.to_agent, "body": ping.body}
    return out


def close_question(db: Session, actor: Actor, question_id: Any, how: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """The asking agent resolves (it has what it needs) or withdraws (no longer needed) its question;
    the owner may resolve one too."""
    if how not in ("resolved", "withdrawn"):
        raise TrackerError("A question is resolved or withdrawn.")
    q, ticket = _question(db, actor, question_id)
    author = _author(actor, data.get("author"))
    if actor.is_owner:
        if how == "withdrawn":
            raise TrackerError("Only the agent who asked withdraws a question; resolve it instead.", 403)
    else:
        _as_own_agent(actor, author)
        _need(actor, "can_comment", "close questions")
        if author.lower() != q.asked_by.lower():
            raise TrackerError(f"Only {q.asked_by}, who asked it, or the user closes this question.", 403)
    if q.status not in QUESTION_ACTIVE:
        raise TrackerError(f"This question is already {q.status}.", 409)
    note = _text(data.get("note"), "note", 2000).strip()
    now = time.time()
    q.status, q.closed_at, q.closed_by, q.updated = how, now, author, now
    _event(db, actor, ticket.id, author, "comment" if actor.is_owner else "note",
           f"{'Resolved' if how == 'resolved' else 'Withdrew'} question {q.id} (**{q.title}**)" + (f": {note}" if note else ""), ts=now)
    ticket.updated = now
    if not actor.is_owner:
        _touch_author(actor, author)
    db.commit()
    return get_question(db, actor, q.id)
