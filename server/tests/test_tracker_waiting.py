"""'Waiting on you' (agents' formal questions and reviews, oldest first; nothing guessed from scopes, notes or
the chat; blocked:user tickets with no question listed apart as unasked) and the stale-work list."""
from sqlalchemy import text

from tracker import db as database

from helpers import API, project, token_for


def _board(client, agent):
    project(client)
    a = agent(token_for(client)["token"])
    keys = {}
    for name, extra in (
        ("decide", {"labels": ["blocked:user"], "scope": "Some background.\nBlocked on the user: keep the GET path or drop it?"}),
        ("decide2", {"labels": ["backend", "blocked:user"], "scope": "Plain scope with no question"}),
        ("review_old", {}), ("review_new", {}), ("working", {"resources": []}), ("busy", {}),
    ):
        r = a.post(f"{API}/projects/DEMO/tickets", json={"author": "asker", "owner": "asker", "title": name,
                                                          "scope": extra.get("scope", "s"), "acceptance": "a",
                                                          "labels": extra.get("labels", [])})
        assert r.status_code == 200, r.text
        keys[name] = r.json()["key"]
    a.post(f"{API}/tickets/{keys['decide2']}/events", data={"author": "asker", "kind": "note",
                                                            "body": "I need a call here. Should the old saves keep their prompts?"})
    for k in ("review_old", "review_new", "working", "busy"):
        assert a.post(f"{API}/tickets/{keys[k]}/move", json={"author": "asker", "status": "in_progress"}).status_code == 200
    for k in ("review_old", "review_new"):
        a.post(f"{API}/tickets/{keys[k]}/move", json={"author": "asker", "status": "testing"})
        a.post(f"{API}/tickets/{keys[k]}/events", data={"author": "asker", "kind": "verification", "body": "ok"})
        assert a.post(f"{API}/tickets/{keys[k]}/move", json={"author": "asker", "status": "uat"}).status_code == 200
    return a, keys


def _age(key, seconds, kind=None):
    """Make a ticket's events older (all of them, or one kind)."""
    db = database.session()
    try:
        q = "UPDATE tracker_events SET ts = ts - :s WHERE ticket_id = (SELECT id FROM tracker_tickets WHERE key = :k)"
        db.execute(text(q + (" AND kind = :kind" if kind else "")), {"s": seconds, "k": key, "kind": kind})
        db.commit()
    finally:
        db.close()


def test_waiting_on_you_counts_questions_and_reviews_and_guesses_nothing(client, agent):
    a, keys = _board(client, agent)
    _age(keys["review_old"], 3600 * 5, kind="status")  # it reached review hours ago
    # What could be guessed: a question in the chat, a 'Blocked on the user:' line, a note asking something
    a.post(f"{API}/projects/DEMO/chat", json={"author": "asker", "body": "@user Shall I take the bigger rewrite next?"})
    w = client.get(f"{API}/projects/DEMO/waiting-on-you").json()
    assert w["questions"] == [] and w["decisions"] == []   # never read as questions (kept empty for older clients)
    assert [r["key"] for r in w["review"]] == [keys["review_old"], keys["review_new"]]  # oldest first
    assert w["review"][0]["waiting_hours"] >= 4.9
    # Both blocked:user tickets have no question: listed apart for their owner to ask, not counted
    assert sorted(u["key"] for u in w["unasked"]) == sorted([keys["decide"], keys["decide2"]])
    assert all(u["owner"] == "asker" for u in w["unasked"])
    assert w["count"] == 2
    # The agent asks on one: it waits on the owner now, and isn't unasked any more
    q = a.post(f"{API}/tickets/{keys['decide']}/questions", json={"author": "asker", "title": "Keep the GET path?", "body": "Context."})
    assert q.status_code == 200, q.text
    w = client.get(f"{API}/projects/DEMO/waiting-on-you").json()
    assert [x["ticket"]["key"] for x in w["asked"]] == [keys["decide"]]
    assert [u["key"] for u in w["unasked"]] == [keys["decide2"]] and w["count"] == 3
    # Agents with a token can read it too
    assert a.get(f"{API}/projects/DEMO/waiting-on-you").status_code == 200


def test_stale_lists_quiet_active_tickets_with_their_machines(client, agent):
    a, keys = _board(client, agent)
    client.post(f"{API}/projects/DEMO/resources", json={"key": "gpu-box", "name": "GPU box"})
    a.patch(f"{API}/tickets/{keys['working']}", json={"author": "asker", "resources": ["gpu-box"]})
    _age(keys["working"], 3600)  # an hour since the owner posted
    s = client.get(f"{API}/projects/DEMO/stale?minutes=35").json()
    assert [x["key"] for x in s["stale"]] == [keys["working"]]
    row = s["stale"][0]
    assert row["owner"] == "asker" and row["holds"] == ["gpu-box"] and row["minutes_quiet"] >= 59 and row["status"] == "in_progress"
    # A chat post naming the ticket counts as the owner posting
    a.post(f"{API}/projects/DEMO/chat", json={"author": "asker", "body": f"Still on {keys['working']}, tests running."})
    assert client.get(f"{API}/projects/DEMO/stale?minutes=35").json()["stale"] == []
    # A token needs can_comment; minutes is checked
    quiet = agent(token_for(client, can_comment=False)["token"])
    assert quiet.get(f"{API}/projects/DEMO/stale").status_code == 403
    assert a.get(f"{API}/projects/DEMO/stale?minutes=0").json()["minutes"] == 5
    assert a.get(f"{API}/projects/DEMO/stale?minutes=abc").status_code in (400, 422)
