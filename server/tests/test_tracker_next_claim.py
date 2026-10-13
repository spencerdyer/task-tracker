"""Agents ask for their next ticket and claim it atomically; the owner field is the agent, labels the kind of work."""
import threading

from helpers import API, project, token_for


def _board(client, agent):
    """DEMO: A P1 startable; B P0 waits on C (in progress); D P0 blocked:user; E P1 needs gpu held by F;
    G P2 in the painter's chain after H (done, owned by the painter); U P3 unclaimed."""
    project(client)
    client.post(f"{API}/projects/DEMO/resources", json={"key": "gpu", "name": "GPU box"})
    a = agent(token_for(client)["token"])

    def mk(title, **kw):
        return a.post(f"{API}/projects/DEMO/tickets", json={"author": "seed", "title": title, **kw}).json()["key"]

    def mv(key, status, who="seed"):
        assert a.post(f"{API}/tickets/{key}/move", json={"author": who, "status": status}).status_code == 200, key

    t = {}
    t["C"] = mk("C running", owner="artist"); mv(t["C"], "in_progress", "artist")
    t["F"] = mk("F rendering", owner="artist", resources=["gpu"]); mv(t["F"], "in_progress", "artist")
    t["H"] = mk("H done", owner="painter"); mv(t["H"], "in_progress", "painter"); mv(t["H"], "testing", "painter")
    a.post(f"{API}/tickets/{t['H']}/events", data={"author": "painter", "kind": "verification", "body": "ok"})
    mv(t["H"], "uat", "painter")
    client.post(f"{API}/tickets/{t['H']}/move", json={"status": "done"})
    t["A"] = mk("A ready", priority="P1", owner="planned-name", labels=["web"])
    t["B"] = mk("B waits", priority="P0", depends_on=[t["C"]])
    t["D"] = mk("D blocked", priority="P0", labels=["blocked:user"])
    t["E"] = mk("E needs gpu", priority="P1", resources=["gpu"])
    t["G"] = mk("G chain", priority="P2", owner="painter", depends_on=[t["H"]])
    t["U"] = mk("U unclaimed", priority="P3")
    return a, t


def test_next_orders_startable_tickets_and_says_why_the_rest_wait(client, agent):
    a, t = _board(client, agent)
    nxt = a.get(f"{API}/projects/DEMO/next?author=builder").json()
    assert [x["key"] for x in nxt["startable"]] == [t["A"], t["U"]]  # P1 before P3; the owner written on A doesn't silo it
    why = {x["key"]: x["reasons"] for x in nxt["not_startable"]}
    assert why[t["B"]] == [f"waiting on {t['C']} (In progress)"]
    assert why[t["D"]] == ["blocked:user: waits on a decision (see its scope)"]
    assert why[t["E"]] == [f"machine GPU box held by {t['F']}"]
    assert why[t["G"]] == [f"part of painter's chain (after {t['H']})"]
    assert [x["key"] for x in nxt["not_startable"]][:2] == [t["B"], t["D"]]  # still in priority order
    # The chain's own agent may take G
    assert t["G"] in [x["key"] for x in a.get(f"{API}/projects/DEMO/next?author=painter").json()["startable"]]
    # The unclaimed one has no owner
    assert client.get(f"{API}/tickets/{t['U']}").json()["owner"] == ""


def test_claim_takes_a_startable_ticket_in_one_step_and_refuses_the_rest(client, agent):
    a, t = _board(client, agent)
    got = a.post(f"{API}/tickets/{t['A']}/claim", json={"author": "builder"})
    assert got.status_code == 200
    j = got.json()
    assert (j["owner"], j["status"], j["events"][-1]["body"]) == ("builder", "in_progress", "Claimed by builder.")
    again = a.post(f"{API}/tickets/{t['A']}/claim", json={"author": "other"})
    assert again.status_code == 409 and "already In progress by builder" in again.json()["detail"]
    for key, why in ((t["B"], "waiting on"), (t["E"], "machine GPU box held by"), (t["D"], "blocked:user"), (t["G"], "painter's chain")):
        r = a.post(f"{API}/tickets/{key}/claim", json={"author": "builder"})
        assert r.status_code == 409 and why in r.json()["detail"], (key, r.json())
    assert a.post(f"{API}/tickets/{t['G']}/claim", json={"author": "painter"}).status_code == 200
    assert [x["key"] for x in a.get(f"{API}/projects/DEMO/next?author=builder").json()["startable"]] == [t["U"]]  # A is gone
    # Who may claim
    assert client.post(f"{API}/tickets/{t['U']}/claim", json={"author": "user"}).status_code == 403  # the owner doesn't claim
    no_move = agent(token_for(client, can_move=False)["token"])
    assert no_move.post(f"{API}/tickets/{t['U']}/claim", json={"author": "x"}).status_code == 403
    tester = agent(token_for(client, owner_only="tester")["token"])
    assert tester.post(f"{API}/tickets/{t['U']}/claim", json={"author": "builder"}).status_code == 403
    assert tester.post(f"{API}/tickets/{t['U']}/claim", json={"author": "tester"}).status_code == 200


def test_two_agents_claiming_at_once_exactly_one_wins(client, agent):
    a, t = _board(client, agent)
    b = agent(token_for(client)["token"])
    results, start = {}, threading.Barrier(2)

    def go(c, name):
        start.wait()
        results[name] = c.post(f"{API}/tickets/{t['U']}/claim", json={"author": name}).status_code

    threads = [threading.Thread(target=go, args=(a, "alpha")), threading.Thread(target=go, args=(b, "beta"))]
    [th.start() for th in threads]
    [th.join() for th in threads]
    assert sorted(results.values()) == [200, 409]
    winner = next(n for n, code in results.items() if code == 200)
    final = client.get(f"{API}/tickets/{t['U']}").json()
    assert final["owner"] == winner and final["status"] == "in_progress"
    assert sum(1 for e in final["events"] if e["kind"] == "status") == 1


def test_the_guide_teaches_next_and_claim(client, agent):
    _board(client, agent)
    g = client.get(f"{API}/guide").text
    assert "## Picking your next ticket" in g and "/claim" in g and "/next?author=" in g
    assert "Don't edit tickets another agent has in progress" in g
