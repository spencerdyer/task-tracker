"""The tracker's core rules: projects and ticket keys, stages and the verification gate, the owner's
approval, attention and the changes feed, attachments, editing, and project access tokens."""
from datetime import timedelta

import pytest

from tracker import auth, db as database, models

from helpers import API, project, token_for


@pytest.fixture
def board(client):
    return project(client)


@pytest.fixture
def builder(board, agent):
    return agent(token_for(board)["token"])


def make(c, **fields):
    body = {"author": "builder", "owner": "builder", "title": "Water pass", "acceptance": "No uphill rivers"}
    body.update(fields)
    res = c.post(f"{API}/projects/DEMO/tickets", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def move(c, key, status, author="builder", note=""):
    return c.post(f"{API}/tickets/{key}/move", json={"status": status, "author": author, "note": note})


def verify(c, key, body="checked", files=None):
    return c.post(f"{API}/tickets/{key}/events", data={"author": "builder", "kind": "verification", "body": body},
                  files=files or [])


# ---------------------------------------------------------------- board rules

def test_project_and_ticket_keys(board, builder):
    assert board.post(f"{API}/projects", json={"key": "DEMO", "name": "Again"}).status_code == 409
    assert board.post(f"{API}/projects", json={"key": "1X", "name": "Bad"}).status_code == 400
    a = builder.post(f"{API}/projects/DEMO/tickets", json={"author": "builder", "title": "One"}).json()
    b = builder.post(f"{API}/projects/DEMO/tickets", json={"author": "builder", "title": "Two", "depends_on": ["demo-1"]}).json()
    assert (a["key"], b["key"]) == ("DEMO-1", "DEMO-2")
    assert a["status"] == "todo" and b["dependencies"][0]["key"] == "DEMO-1"
    assert builder.get(f"{API}/tickets/DEMO-1").json()["blocks"][0]["key"] == "DEMO-2"
    assert builder.post(f"{API}/projects/DEMO/tickets", json={"author": "builder", "title": "X", "depends_on": ["DEMO-9"]}).status_code == 404
    assert builder.post(f"{API}/projects/DEMO/tickets", json={"title": "No author"}).status_code == 400


def test_agent_moves_and_verification_gate(board, builder):
    key = make(builder)["key"]
    assert move(builder, key, "testing").status_code == 403  # must go through In progress
    assert move(builder, key, "in_progress").status_code == 200
    assert move(builder, key, "testing").status_code == 200
    res = move(builder, key, "uat")
    assert res.status_code == 409 and "verification" in res.json()["detail"]
    res = verify(builder, key, "10 seeds, 0 uphill", files=[("files", ("river.png", b"\x89PNG fake", "image/png"))])
    assert res.status_code == 200
    ev = res.json()["events"][-1]
    assert ev["kind"] == "verification" and ev["attachments"][0]["filename"] == "river.png"
    assert ev["author"] == "builder" and ev["token"] == "agents"
    got = builder.get(ev["attachments"][0]["url"])
    assert got.status_code == 200 and got.content == b"\x89PNG fake"
    assert move(builder, key, "uat").status_code == 200
    assert move(builder, key, "done").status_code == 403  # only the owner approves
    assert move(builder, key, "done", author="user").status_code == 403  # naming yourself 'user' doesn't help
    res = move(board, key, "done")
    assert res.status_code == 200 and res.json()["events"][-1]["author"] == "user"


def test_attachment_type_from_name_when_upload_says_octet_stream(builder):
    """curl uploads an .mp4 as application/octet-stream; the viewer needs video/mp4."""
    key = make(builder)["key"]
    res = verify(builder, key, files=[("files", ("clip.mp4", b"fake", "application/octet-stream")),
                                      ("files", ("log.bin", b"\x00", "application/octet-stream")),
                                      ("files", ("shot.png", b"fake", "image/png"))])
    mimes = {a["filename"]: a["mime"] for a in res.json()["events"][-1]["attachments"]}
    assert mimes == {"clip.mp4": "video/mp4", "log.bin": "application/octet-stream", "shot.png": "image/png"}


def test_an_audio_type_is_believed_only_when_the_name_is_audio(board, builder):
    """Audio and video are served without the sandbox, so a sender can't make a page one by its type:
    evil.html sent as audio/mpeg is plain text in a sandbox, a real .mp3 plays, a playlist stays sandboxed."""
    key = make(builder)["key"]
    res = verify(builder, key, files=[("files", ("evil.html", b"<script>alert(1)</script>", "audio/mpeg")),
                                      ("files", ("song.mp3", b"ID3fake", "audio/mpeg")),
                                      ("files", ("list.m3u", b"#EXTM3U\nhttp://example.test/a.mp3\n", "audio/x-mpegurl"))])
    atts = {a["filename"]: a for a in res.json()["events"][-1]["attachments"]}
    assert {n: a["mime"] for n, a in atts.items()} == {
        "evil.html": "text/plain", "song.mp3": "audio/mpeg", "list.m3u": "audio/x-mpegurl"}
    served = {n: board.get(a["url"]) for n, a in atts.items()}
    assert all(r.status_code == 200 for r in served.values())
    evil = served["evil.html"].headers
    assert evil["content-type"].startswith("text/plain") and evil["content-security-policy"].startswith("sandbox")
    assert "content-security-policy" not in served["song.mp3"].headers  # plays in a tab of its own
    assert served["list.m3u"].headers["content-security-policy"].startswith("sandbox")


def test_send_back_needs_attention_until_owner_answers(board, builder):
    key = make(builder)["key"]
    move(builder, key, "in_progress"); move(builder, key, "testing"); verify(builder, key); move(builder, key, "uat")
    assert builder.get(f"{API}/projects/DEMO/tickets?owner=builder&attention=true").json()["tickets"] == []
    assert move(board, key, "todo").status_code == 400  # sending back says what must change
    res = move(board, key, "todo", note="Lake shores are still cliffs")
    assert res.status_code == 200 and res.json()["reopened"] == 1
    listed = builder.get(f"{API}/projects/DEMO/tickets?owner=builder&attention=true").json()["tickets"]
    assert [x["key"] for x in listed] == [key]
    # A verification recorded before the send-back doesn't count again: testing must re-verify.
    move(builder, key, "in_progress"); move(builder, key, "testing")
    assert move(builder, key, "uat").status_code == 409
    assert builder.get(f"{API}/projects/DEMO/tickets?owner=builder&attention=true").json()["tickets"] == []


def test_owner_comment_raises_attention_and_changes_feed(board, builder):
    key = make(builder)["key"]
    board.post(f"{API}/tickets/{key}/events", data={"kind": "comment", "body": "Use real basins"})
    assert builder.get(f"{API}/projects/DEMO/tickets?attention=true").json()["tickets"][0]["key"] == key
    builder.post(f"{API}/tickets/{key}/events", data={"author": "builder", "kind": "note", "body": "Will do"})
    assert builder.get(f"{API}/projects/DEMO/tickets?attention=true").json()["tickets"] == []
    feed = builder.get(f"{API}/projects/DEMO/changes?since=0").json()["changes"]
    assert [(c["kind"], c["author"]) for c in feed] == [("created", "builder"), ("comment", "user"), ("note", "builder")]


def test_edit_and_validation(board, builder):
    key = make(builder)["key"]
    res = board.patch(f"{API}/tickets/{key}", json={"priority": "p0", "scope": "Bigger"})
    assert res.status_code == 200 and res.json()["priority"] == "P0" and res.json()["events"][-1]["kind"] == "edit"
    assert board.patch(f"{API}/tickets/{key}", json={"priority": "P9"}).status_code == 400
    assert board.patch(f"{API}/tickets/{key}", json={"depends_on": [key]}).status_code == 400
    assert verify(builder, key, "").status_code == 400
    assert builder.get(f"{API}/guide").text.startswith("# Tracker")
    assert "http://testserver/api/tracker" in builder.get(f"{API}/guide").text


# ---------------------------------------------------------------- tokens

def test_a_token_reaches_the_tracker_and_nothing_else(board, builder):
    assert builder.post("/api/auth/password", json={"current": "x", "new": "y" * 10}).status_code == 403
    assert builder.get(f"{API}/view").status_code == 403
    assert builder.get(f"{API}/me").json()["token"]["project"] == "DEMO"
    with pytest.raises(Exception):
        with builder.websocket_connect("/api/ws"):
            pass


def test_a_token_sees_one_project_only(board, builder):
    project(board, "OPS", "Operations")
    other = board.post(f"{API}/projects/OPS/tickets", json={"title": "Private"}).json()["key"]
    assert [p["key"] for p in builder.get(f"{API}/projects").json()["projects"]] == ["DEMO"]
    assert builder.get(f"{API}/projects/OPS/tickets").status_code == 404
    assert builder.get(f"{API}/tickets/{other}").status_code == 404
    assert builder.post(f"{API}/projects/OPS/tickets", json={"author": "builder", "title": "x"}).status_code == 404
    assert builder.post(f"{API}/projects", json={"key": "ZZ", "name": "Mine"}).status_code == 403
    assert builder.get(f"{API}/projects/DEMO/tokens").status_code == 403  # tokens are the owner's to manage
    assert builder.post(f"{API}/projects/DEMO/tokens", json={"name": "x"}).status_code == 403


def test_switches_and_owner_limit(board, agent):
    reader = agent(token_for(board, can_create=False, can_edit=False, can_move=False, can_comment=False)["token"])
    assert reader.post(f"{API}/projects/DEMO/tickets", json={"author": "r", "title": "x"}).status_code == 403
    key = make(board)["key"]  # owned by builder
    assert reader.get(f"{API}/tickets/{key}").status_code == 200
    assert reader.patch(f"{API}/tickets/{key}", json={"author": "r", "title": "y"}).status_code == 403
    assert move(reader, key, "in_progress", author="r").status_code == 403
    assert reader.post(f"{API}/tickets/{key}/events", data={"author": "r", "kind": "comment", "body": "hi"}).status_code == 403

    tester = agent(token_for(board, owner_only="tester")["token"])
    mine = tester.post(f"{API}/projects/DEMO/tickets", json={"author": "tester", "title": "Board on a phone"}).json()
    assert mine["owner"] == "tester"  # new tickets get the token's owner
    assert tester.post(f"{API}/projects/DEMO/tickets", json={"author": "tester", "owner": "builder", "title": "x"}).status_code == 403
    assert move(tester, mine["key"], "in_progress", author="tester").status_code == 200
    assert move(tester, key, "in_progress", author="tester").status_code == 403  # builder's ticket
    assert tester.patch(f"{API}/tickets/{key}", json={"author": "tester", "title": "mine now"}).status_code == 403
    assert tester.patch(f"{API}/tickets/{mine['key']}", json={"author": "tester", "owner": "builder"}).status_code == 403
    assert tester.post(f"{API}/tickets/{key}/events", data={"author": "tester", "kind": "note", "body": "x"}).status_code == 403
    assert tester.post(f"{API}/tickets/{key}/events", data={"author": "tester", "kind": "comment", "body": "question"}).status_code == 200


def test_revoked_and_expired_tokens_stop_at_once(board, agent):
    made = token_for(board)
    a = agent(made["token"])
    assert a.get(f"{API}/me").status_code == 200
    listed = board.get(f"{API}/projects/DEMO/tokens").json()["tokens"]
    assert listed[0]["name"] == "agents" and listed[0]["last_used_at"] and "token" not in listed[0]
    assert board.delete(f"{API}/tokens/{made['id']}").status_code == 200
    assert a.get(f"{API}/me").status_code == 401
    assert board.get(f"{API}/projects/DEMO/tokens").json()["tokens"] == []

    old = token_for(board, name="old")
    db = database.session()
    try:
        row = db.get(models.TrackerToken, old["id"])
        row.expires_at = auth.utcnow() - timedelta(minutes=1)
        db.commit()
    finally:
        db.close()
    assert agent(old["token"]).get(f"{API}/me").status_code == 401
