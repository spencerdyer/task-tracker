"""The Agents view: who is working on what, who is idle, and what waits on the owner."""
from helpers import API, project, token_for


def test_agents_view_from_the_projects_history(client, agent):
    project(client)
    client.post(f"{API}/projects/DEMO/resources", json={"key": "gpu", "name": "GPU box"})
    a = agent(token_for(client)["token"])

    def mk(title, who, **kw):
        return a.post(f"{API}/projects/DEMO/tickets", json={"author": who, "title": title, **kw}).json()["key"]

    def mv(key, status, who):
        assert a.post(f"{API}/tickets/{key}/move", json={"author": who, "status": status}).status_code == 200

    art = mk("Render chapter", "artist", owner="artist", resources=["gpu"]); mv(art, "in_progress", "artist")
    phone = mk("Phone screens", "tester", owner="tester"); mv(phone, "in_progress", "tester"); mv(phone, "testing", "tester")
    old = mk("Old work", "writer", owner="writer"); mv(old, "in_progress", "writer"); mv(old, "testing", "writer")
    a.post(f"{API}/tickets/{old}/events", data={"author": "writer", "kind": "verification", "body": "ok"})
    mv(old, "uat", "writer")  # writer is idle now, with one ticket waiting for review
    decision = mk("Pick a font", "writer", owner="writer", labels=["blocked:user"])
    free = mk("Unclaimed polish", "writer", priority="P1")
    claimed_plan = mk("Planned for artist", "writer", owner="artist")
    view = a.get(f"{API}/projects/DEMO/agents").json()
    by = {x["name"]: x for x in view["agents"]}
    assert sorted(x["name"] for x in view["agents"][:2]) == ["artist", "tester"]
    assert by["artist"]["idle"] is False and [t["key"] for t in by["artist"]["current"]] == [art]
    assert by["artist"]["current"][0]["resources"] == ["gpu"]
    assert by["tester"]["current"][0]["status"] == "testing"
    assert by["writer"]["idle"] is True and [t["key"] for t in by["writer"]["in_review"]] == [old]
    assert by["writer"]["last_activity"]["ticket"] == claimed_plan and by["writer"]["last_activity"]["what"] == "created"
    assert view["agents"][-1]["name"] == "writer"  # idle agents after busy ones
    assert [t["key"] for t in view["startable_unclaimed"]] == [free]  # a planned owner isn't unclaimed; blocked isn't startable
    w = view["waiting_on_user"]
    # The blocked:user ticket has no question: unasked (its owner should ask), not a guessed decision
    assert w["count"] == 1 and [t["key"] for t in w["review"]] == [old] and w["decisions"] == [] and w["asked"] == []
    assert [t["key"] for t in w["unasked"]] == [decision]
    assert "user" not in by
    # The owner sees the same
    assert client.get(f"{API}/projects/DEMO/agents").json()["waiting_on_user"]["count"] == 1
