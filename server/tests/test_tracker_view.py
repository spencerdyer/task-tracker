"""Which projects the owner's board shows at once (GET/PUT /api/tracker/view): kept in the given order once
cleaned (upper-cased, once each, unknown keys dropped, at most 30), owner only, and announced live."""
import pytest

from helpers import API, project, token_for


def _projects(client, *keys):
    for k in keys:
        project(client, k, f"Project {k}")


def test_a_selection_is_kept_in_order_and_cleaned(client):
    _projects(client, "DEMO", "OPS", "QA")
    assert client.get(f"{API}/view").json() == {"projects": []}   # nothing picked yet
    r = client.put(f"{API}/view", json={"projects": ["ops", "DEMO", "OPS", "ZZ", "DEMO"]})
    assert r.status_code == 200, r.text
    assert r.json() == {"projects": ["OPS", "DEMO"]}   # upper-cased, once each, unknown ZZ dropped
    assert client.get(f"{API}/view").json() == {"projects": ["OPS", "DEMO"]}
    client.put(f"{API}/view", json={"projects": ["QA"]})   # one project: the single board
    assert client.get(f"{API}/view").json() == {"projects": ["QA"]}


def test_at_most_thirty_are_kept(client):
    keys = [f"P{chr(65 + i // 26)}{chr(65 + i % 26)}" for i in range(32)]
    _projects(client, *keys)
    got = client.put(f"{API}/view", json={"projects": keys}).json()["projects"]
    assert got == keys[:30]


def test_only_the_owner_reads_or_changes_it(client, agent, anon):
    _projects(client, "DEMO")
    a = agent(token_for(client)["token"])
    assert a.get(f"{API}/view").status_code == 403
    assert a.put(f"{API}/view", json={"projects": ["DEMO"]}).status_code == 403
    assert anon.get(f"{API}/view").status_code == 401
    assert client.get(f"{API}/view").json() == {"projects": []}


def test_a_body_that_is_not_an_object_is_refused(client):
    _projects(client, "DEMO")
    client.put(f"{API}/view", json={"projects": ["DEMO"]})
    assert client.put(f"{API}/view", json=["DEMO"]).status_code == 400
    assert client.get(f"{API}/view").json() == {"projects": ["DEMO"]}


def test_what_isnt_a_selection_is_refused_and_nothing_changes(client):
    _projects(client, "DEMO")
    client.put(f"{API}/view", json={"projects": ["DEMO"]})
    for bad in ({"projects": "DEMO"}, {"projects": [3]}, {"projects": {"DEMO": 1}}):
        r = client.put(f"{API}/view", json=bad)
        assert r.status_code in (400, 422), (bad, r.status_code)
    assert client.get(f"{API}/view").json() == {"projects": ["DEMO"]}


def test_open_browsers_hear_of_a_change(client, captured):
    _projects(client, "DEMO")
    client.put(f"{API}/view", json={"projects": ["DEMO"]})
    assert [d for k, d in captured if k == "tracker_view_changed"] == [{"projects": ["DEMO"]}]
