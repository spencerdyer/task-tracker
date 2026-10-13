"""Formal questions on tickets. An agent asks the owner (context, options, its recommendation), the owner
answers, either side replies in a thread, and the asking agent resolves or withdraws it. 'Waiting on you'
counts open questions instead of guessing from question marks. Each owner answer pings the asker in the chat."""
import pytest

from helpers import API, project, token_for


@pytest.fixture
def qboard(client, agent):
    project(client)
    asker = agent(token_for(client)["token"])
    r = asker.post(f"{API}/projects/DEMO/tickets", json={"author": "asker", "owner": "asker", "title": "Saves",
                                                          "scope": "s", "acceptance": "a"})
    assert r.status_code == 200, r.text
    return client, asker, r.json()["key"]


ASK = {"author": "asker", "title": "Keep old saves' prompts byte-identical?",
       "body": "Context: a rewrite changes the planner prompt.\n\n**I recommend** keeping them.",
       "options": [{"label": "Keep", "detail": "Old saves keep today's prompt"},
                   {"label": "Upgrade", "detail": "Every save gets the new prompt"}],
       "recommended": "keep"}


def _ask(asker, key, **extra):
    r = asker.post(f"{API}/tickets/{key}/questions", json={**ASK, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def test_the_whole_round_trip(qboard):
    owner, asker, key = qboard
    q = _ask(asker, key)
    assert q["status"] == "open" and q["asked_by"] == "asker" and q["recommended"] == "Keep"
    assert [o["label"] for o in q["options"]] == ["Keep", "Upgrade"]

    # It's on the ticket, in the project's list and counted as waiting on the owner
    t = owner.get(f"{API}/tickets/{key}").json()
    assert t["questions"] == {"open": 1, "answered": 0}
    listed = owner.get(f"{API}/projects/DEMO/questions?status=active").json()
    assert [x["id"] for x in listed["questions"]] == [q["id"]] and listed["open"] == 1
    w = owner.get(f"{API}/projects/DEMO/waiting-on-you").json()
    assert [x["id"] for x in w["asked"]] == [q["id"]] and w["count"] == 1

    # The owner picks an option and writes; the agent's answered filter returns it
    r = owner.post(f"{API}/questions/{q['id']}/replies", json={"choice": "upgrade", "body": "Upgrade, but tell me which saves."})
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["status"] == "answered" and got["chosen"] == "Upgrade"
    assert got["replies"][0]["author"] == "user" and got["replies"][0]["choice"] == "Upgrade"
    answered = asker.get(f"{API}/projects/DEMO/questions?asked_by=asker&status=answered").json()["questions"]
    assert [x["id"] for x in answered] == [q["id"]]
    t = asker.get(f"{API}/tickets/{key}").json()
    assert t["attention"] is True and t["questions"] == {"open": 0, "answered": 1}
    assert owner.get(f"{API}/projects/DEMO/waiting-on-you").json()["count"] == 0

    # The agent asks back: open again, waiting on the owner
    r = asker.post(f"{API}/questions/{q['id']}/replies", json={"author": "asker", "body": "Three saves use the old planner: A, B, C. All three?"})
    assert r.status_code == 200 and r.json()["status"] == "open"
    assert owner.get(f"{API}/projects/DEMO/waiting-on-you").json()["count"] == 1
    r = owner.post(f"{API}/questions/{q['id']}/replies", json={"body": "All three."})
    assert r.json()["status"] == "answered" and len(r.json()["replies"]) == 3

    # The agent resolves it: it leaves the open list and the ticket's counts
    r = asker.post(f"{API}/questions/{q['id']}/resolve", json={"author": "asker", "note": "Upgrading A, B, C."})
    assert r.status_code == 200 and r.json()["status"] == "resolved" and r.json()["closed_by"] == "asker"
    assert owner.get(f"{API}/projects/DEMO/questions?status=active").json()["questions"] == []
    assert owner.get(f"{API}/tickets/{key}").json()["questions"] == {"open": 0, "answered": 0}
    assert owner.post(f"{API}/questions/{q['id']}/replies", json={"body": "late"}).status_code == 409

    # The ticket's history says what happened
    bodies = [e["body"] for e in owner.get(f"{API}/tickets/{key}").json()["events"]]
    assert any("Asked the user" in b for b in bodies) and any("chose **Upgrade**" in b for b in bodies)
    assert any("Resolved question" in b for b in bodies)


def test_a_token_never_writes_as_the_owner(qboard):
    owner, asker, key = qboard
    q = _ask(asker, key)
    for name in ("user", "USER", "ｕｓｅｒ", "user​"):
        r = asker.post(f"{API}/questions/{q['id']}/replies", json={"author": name, "body": "yes", "choice": "Keep"})
        assert r.status_code == 403, (name, r.text)
    # An agent can't pick an option for the owner
    assert asker.post(f"{API}/questions/{q['id']}/replies", json={"author": "asker", "choice": "Keep"}).status_code == 403
    assert asker.get(f"{API}/questions/{q['id']}").json()["status"] == "open"
    # The owner can't ask (questions are the agents'), and asking needs a title and real options
    assert owner.post(f"{API}/tickets/{key}/questions", json=ASK).status_code == 400
    assert asker.post(f"{API}/tickets/{key}/questions", json={**ASK, "title": " "}).status_code == 400
    assert asker.post(f"{API}/tickets/{key}/questions", json={**ASK, "recommended": "Neither"}).status_code == 400
    assert asker.post(f"{API}/tickets/{key}/questions", json={**ASK, "options": [{"label": "A"}, {"label": "a"}]}).status_code == 400
    assert owner.post(f"{API}/questions/{q['id']}/replies", json={"choice": "Maybe"}).status_code == 400


def test_only_the_asking_agent_replies_resolves_or_withdraws(qboard):
    owner, asker, key = qboard
    q = _ask(asker, key)
    helper = asker  # same token, another name: names are per call on an open token
    assert helper.post(f"{API}/questions/{q['id']}/replies", json={"author": "helper", "body": "me too"}).status_code == 403
    assert helper.post(f"{API}/questions/{q['id']}/resolve", json={"author": "helper"}).status_code == 403
    # The owner may resolve but not withdraw; the asker may withdraw
    assert owner.post(f"{API}/questions/{q['id']}/withdraw", json={}).status_code == 403
    r = asker.post(f"{API}/questions/{q['id']}/withdraw", json={"author": "asker", "note": "Found it in the docs."})
    assert r.status_code == 200 and r.json()["status"] == "withdrawn"
    assert asker.post(f"{API}/questions/{q['id']}/resolve", json={"author": "asker"}).status_code == 409
    q2 = _ask(asker, key, title="Second")
    assert owner.post(f"{API}/questions/{q2['id']}/resolve", json={}).json()["closed_by"] == "user"


def test_token_switches_owner_only_and_project(qboard, agent):
    owner, asker, key = qboard
    quiet = agent(token_for(owner, can_comment=False)["token"])
    assert quiet.post(f"{API}/tickets/{key}/questions", json=ASK).status_code == 403
    # owner_only: asks only as its own agent, and only on that agent's tickets
    own = agent(token_for(owner, owner_only="helper")["token"])
    assert own.post(f"{API}/tickets/{key}/questions", json={**ASK, "author": "helper"}).status_code == 403  # the asker's ticket
    mine = own.post(f"{API}/projects/DEMO/tickets", json={"author": "helper", "owner": "helper", "title": "W", "scope": "s", "acceptance": "a"})
    assert mine.status_code == 200, mine.text
    assert own.post(f"{API}/tickets/{mine.json()['key']}/questions", json={**ASK, "author": "asker"}).status_code == 403
    assert own.post(f"{API}/tickets/{mine.json()['key']}/questions", json={**ASK, "author": "helper"}).status_code == 200
    # Another project's token sees none of it
    project(owner, "OPS", "Operations")
    other = agent(token_for(owner, project="OPS")["token"])
    q = _ask(asker, key)
    assert other.get(f"{API}/questions/{q['id']}").status_code == 404
    assert other.post(f"{API}/questions/{q['id']}/replies", json={"author": "x", "body": "y"}).status_code == 404
    assert other.get(f"{API}/projects/DEMO/questions").status_code == 404


def test_waiting_on_you_counts_only_asked_questions(qboard):
    owner, asker, key = qboard
    # A blocked:user ticket with an ask in its scope and in the chat is no question until one is asked
    assert asker.patch(f"{API}/tickets/{key}", json={"author": "asker", "labels": ["blocked:user"],
                                                      "scope": "Blocked on the user: keep the GET path?"}).status_code == 200
    asker.post(f"{API}/projects/DEMO/chat", json={"author": "asker", "body": f"@user About {key}: keep the GET path?", "tickets": [key]})
    w = owner.get(f"{API}/projects/DEMO/waiting-on-you").json()
    assert w["decisions"] == [] and w["questions"] == [] and w["asked"] == [] and w["count"] == 0
    assert [u["key"] for u in w["unasked"]] == [key]
    q = _ask(asker, key)
    w = owner.get(f"{API}/projects/DEMO/waiting-on-you").json()
    assert [x["id"] for x in w["asked"]] == [q["id"]] and w["unasked"] == [] and w["count"] == 1
    # Answered (waiting for the agent): not counted, and not unasked either
    owner.post(f"{API}/questions/{q['id']}/replies", json={"body": "Keep it."})
    w = owner.get(f"{API}/projects/DEMO/waiting-on-you").json()
    assert w["asked"] == [] and w["unasked"] == [] and w["count"] == 0


def test_list_order_and_filters(qboard):
    owner, asker, key = qboard
    a = _ask(asker, key, title="First")
    b = _ask(asker, key, title="Second")
    c = _ask(asker, key, title="Third")
    owner.post(f"{API}/questions/{b['id']}/replies", json={"body": "done"})
    asker.post(f"{API}/questions/{c['id']}/withdraw", json={"author": "asker"})
    order = [x["title"] for x in owner.get(f"{API}/projects/DEMO/questions").json()["questions"]]
    assert order == ["First", "Second", "Third"]  # open, then answered, then closed
    assert [x["id"] for x in owner.get(f"{API}/projects/DEMO/questions?status=closed").json()["questions"]] == [c["id"]]
    assert [x["id"] for x in owner.get(f"{API}/projects/DEMO/questions?ticket={key}&status=open").json()["questions"]] == [a["id"]]
    assert owner.get(f"{API}/projects/DEMO/questions?status=bogus").status_code == 400
    assert owner.get(f"{API}/questions/999999").status_code == 404


def test_an_answer_pings_the_asker_in_the_chat(qboard):
    """The owner's answer posts a chat message to the asker, so it's in /chat/unread (which agents read every
    turn), with questions_answered; agent replies and closes send nothing; other agents don't get it."""
    owner, asker, key = qboard
    q = _ask(asker, key)
    before = asker.get(f"{API}/projects/DEMO/chat/unread?for=asker").json()
    assert before["count"] == 0 and before["questions_answered"] == 0
    r = owner.post(f"{API}/questions/{q['id']}/replies", json={"choice": "Keep", "body": "Keep them."})
    assert r.status_code == 200 and r.json()["ping"]["to"] == "asker"
    unread = asker.get(f"{API}/projects/DEMO/chat/unread?for=asker").json()
    assert unread["count"] == 1 and unread["questions_answered"] == 1
    msg = unread["messages"][0]
    assert msg["author"] == "task-tracker" and msg["to"] == "asker" and f"#{q['id']}" in msg["body"] and key in msg["body"]
    assert "chose Keep" in msg["body"] and [t["key"] for t in msg["tickets"]] == [key]
    # Another agent's unread doesn't carry it
    other = asker.get(f"{API}/projects/DEMO/chat/unread?for=helper").json()
    assert other["count"] == 0 and other["questions_answered"] == 0
    # The asker reads it; its reply and resolve send nothing more, and the count follows the question's state
    assert asker.post(f"{API}/projects/DEMO/chat/read", json={"author": "asker"}).status_code == 200
    r = asker.post(f"{API}/questions/{q['id']}/replies", json={"author": "asker", "body": "Which saves?"})
    assert "ping" not in r.json()
    after = asker.get(f"{API}/projects/DEMO/chat/unread?for=asker").json()
    assert after["count"] == 0 and after["questions_answered"] == 0
    owner.post(f"{API}/questions/{q['id']}/replies", json={"body": "All of them."})
    assert asker.get(f"{API}/projects/DEMO/chat/unread?for=asker").json()["count"] == 1  # one ping per owner reply
    asker.post(f"{API}/questions/{q['id']}/resolve", json={"author": "asker"})
    assert asker.get(f"{API}/projects/DEMO/chat/unread?for=asker").json()["questions_answered"] == 0
    # The owner's own unread (agents' messages) isn't filled with these pings
    assert all(m["author"] not in ("user", "task-tracker") for m in owner.get(f"{API}/projects/DEMO/chat/unread").json()["messages"])


def test_tracker_is_a_reserved_name(qboard):
    """Only the Tracker writes as 'tracker'; a token can't post, ask or reply under that name."""
    owner, asker, key = qboard
    for name in ("task-tracker", "TASK-TRACKER", "ｔａｓｋ-ｔｒａｃｋｅｒ", "task-tracker​"):
        assert asker.post(f"{API}/projects/DEMO/chat", json={"author": name, "body": "hello"}).status_code == 403, name
        assert asker.post(f"{API}/tickets/{key}/questions", json={**ASK, "author": name}).status_code == 403, name
    # The owner's chat unread doesn't count the Tracker's pings
    q = _ask(asker, key)
    owner.post(f"{API}/questions/{q['id']}/replies", json={"body": "Yes."})
    assert owner.get(f"{API}/projects/DEMO/chat/unread").json()["count"] == 0
    # The full chat shows the ping, authored by the Tracker
    msgs = owner.get(f"{API}/projects/DEMO/chat").json()["messages"]
    assert [m["author"] for m in msgs][-1] == "task-tracker"


def test_the_same_answer_twice_is_one_answer_and_one_ping(qboard):
    """The same reply sent twice (a double tap, a retried request) adds nothing; a different follow-up
    before the agent replies says 'replied again'."""
    owner, asker, key = qboard
    q = _ask(asker, key)
    pick = q["options"][0]["label"]
    for _ in range(2):
        r = owner.post(f"{API}/questions/{q['id']}/replies", json={"choice": pick})
        assert r.status_code == 200, r.text
    got = owner.get(f"{API}/questions/{q['id']}").json()
    assert len(got["replies"]) == 1
    pings = [m for m in owner.get(f"{API}/projects/DEMO/chat").json()["messages"] if m["author"] == "task-tracker"]
    assert len(pings) == 1 and "answered your question" in pings[0]["body"]
    owner.post(f"{API}/questions/{q['id']}/replies", json={"body": "And use the staging box."})
    pings = [m for m in owner.get(f"{API}/projects/DEMO/chat").json()["messages"] if m["author"] == "task-tracker"]
    assert len(pings) == 2 and "replied again to your question" in pings[-1]["body"]
    assert len(owner.get(f"{API}/questions/{q['id']}").json()["replies"]) == 2
    # After the agent replies, the owner's next answer is an answer again
    asker.post(f"{API}/questions/{q['id']}/replies", json={"author": "asker", "body": "Which branch?"})
    owner.post(f"{API}/questions/{q['id']}/replies", json={"choice": pick})
    pings = [m for m in owner.get(f"{API}/projects/DEMO/chat").json()["messages"] if m["author"] == "task-tracker"]
    assert len(pings) == 3 and "answered your question" in pings[-1]["body"]
