"""A small made-up board to try the tracker with: `tracker-seed` (once, on an empty data folder).

Two projects, tickets in every stage, a verification, a question waiting for the owner, chat
messages and a shared machine. Everything is invented. It prints an agent token for DEMO.
"""
from __future__ import annotations

import sys

from . import db as database, models, service as svc
from .auth import Principal


def _ticket(db, agent, project, **fields):
    return svc.create_ticket(db, agent, project, {"author": fields.get("owner") or "planner", **fields})


def seed(db) -> str:
    if db.query(models.TrackerProject).count():
        raise SystemExit("This data folder already has projects; the seed is for an empty one.")
    owner = svc.Actor(is_owner=True)
    svc.create_project(db, owner, "DEMO", "Lighthouse app", "A made-up mobile app for a coastal walking club.")
    svc.create_project(db, owner, "OPS", "Club website", "The walking club's website and its hosting.")
    svc.create_resource(db, owner, "DEMO", {"key": "test-phone", "name": "Test phone",
                                            "description": "The shared test device: one agent at a time."})
    _info, token = svc.create_token(db, owner, "DEMO", {"name": "demo agents"})
    agent = svc.actor_for(db, Principal(method="tracker_token",
                                        tracker_token_id=db.query(models.TrackerToken).first().id))

    a = _ticket(db, agent, "DEMO", owner="builder", priority="P1", title="Walk list loads offline",
                scope="In: cache the last walk list on the device.\nOut: maps.",
                acceptance="With the network off, the walk list still shows the last 20 walks.", labels=["mobile"])
    b = _ticket(db, agent, "DEMO", owner="builder", priority="P2", title="Tide times on each walk",
                scope="In: show the next high and low tide on a coastal walk.",
                acceptance="A coastal walk shows today's tides; an inland one shows none.",
                labels=["mobile"], depends_on=[a["key"]], resources=["test-phone"])
    c = _ticket(db, agent, "DEMO", owner="reviewer", priority="P3", title="Dark mode for the walk card",
                acceptance="The walk card reads at 4.5:1 in dark mode.", labels=["design"])
    _ticket(db, owner, "OPS", owner="planner", priority="P2", title="Renew the site's certificate automatically",
            acceptance="The renewal job runs monthly and its last run is shown on the status page.", labels=["ops"])

    svc.move_ticket(db, agent, a["key"], "in_progress", "builder", "Starting with the cache layer.")
    svc.add_event(db, agent, models.OWNER_ID, a["key"], "builder", "note",
                  "The cache keeps the list as JSON; maps stay online-only as scoped.")
    svc.move_ticket(db, agent, a["key"], "testing", "builder")
    svc.add_event(db, agent, models.OWNER_ID, a["key"], "builder", "verification",
                  "Airplane mode on: the list shows 20 walks from the cache; off again: it refreshes.")
    svc.move_ticket(db, agent, a["key"], "uat", "builder", "Ready for you to try.")

    svc.move_ticket(db, agent, c["key"], "in_progress", "reviewer")
    svc.ask_question(db, agent, c["key"], {
        "author": "reviewer", "title": "Which accent colour for dark mode?",
        "body": "The light theme's teal reads at 3.9:1 on the dark card. A lighter teal passes at 5.2:1.",
        "options": [{"label": "Lighter teal", "detail": "Passes contrast; slightly different from light mode"},
                    {"label": "Keep teal", "detail": "Matches light mode; fails contrast on small text"}],
        "recommended": "Lighter teal"})
    svc.post_message(db, agent, "DEMO", {"author": "builder",
                                         "body": f"{a['key']} is ready for you; {b['key']} waits on it."})
    svc.post_message(db, owner, "DEMO", {"author": "user", "body": "@builder thanks, I'll try it on the train."})
    return token


def main() -> None:
    database.init()
    db = database.session()
    try:
        token = seed(db)
    finally:
        db.close()
    print("Seeded projects DEMO and OPS.")
    print(f"An agent token for DEMO (shown once): {token}", file=sys.stdout)


if __name__ == "__main__":
    main()
