"""Shared machines (resources) on tickets, and which tickets hold each one."""
from helpers import API, project, token_for


def test_machines_are_validated_and_editable_by_owner_and_editing_agents(client, agent):
    project(client)
    r = client.post(f"{API}/projects/DEMO/resources", json={"key": "gpu-box", "name": "GPU box", "description": "Image jobs"})
    assert r.status_code == 200 and r.json() == {"key": "gpu-box", "name": "GPU box", "description": "Image jobs", "busy": False, "holders": []}
    assert client.post(f"{API}/projects/DEMO/resources", json={"key": "GPU 1"}).status_code == 400
    assert client.post(f"{API}/projects/DEMO/resources", json={"key": "gpu-box"}).status_code == 409
    editor = agent(token_for(client)["token"])
    assert editor.post(f"{API}/projects/DEMO/resources", json={"key": "test-phone", "name": "Test phone"}).status_code == 200
    reader = agent(token_for(client, can_edit=False)["token"])
    assert reader.post(f"{API}/projects/DEMO/resources", json={"key": "x"}).status_code == 403
    assert reader.get(f"{API}/projects/DEMO/resources").status_code == 200
    assert client.patch(f"{API}/projects/DEMO/resources/gpu-box", json={"name": "Big GPU box"}).json()["name"] == "Big GPU box"
    # Tickets only take known machines
    bad = editor.post(f"{API}/projects/DEMO/tickets", json={"author": "a", "title": "x", "resources": ["nope"]})
    assert bad.status_code == 400 and "No machine nope" in bad.json()["detail"]


def test_a_machine_is_held_while_a_ticket_needing_it_is_in_progress_or_testing(client, agent):
    project(client)
    client.post(f"{API}/projects/DEMO/resources", json={"key": "gpu-box", "name": "GPU box"})
    a = agent(token_for(client)["token"])
    one = a.post(f"{API}/projects/DEMO/tickets", json={"author": "artist", "owner": "artist", "title": "Render", "resources": ["GPU-BOX"]}).json()
    two = a.post(f"{API}/projects/DEMO/tickets", json={"author": "editor", "owner": "editor", "title": "Video", "resources": ["gpu-box"]}).json()
    assert one["resources"] == ["gpu-box"]
    res = lambda: client.get(f"{API}/projects/DEMO/resources").json()["resources"][0]
    waits = lambda: {t["key"]: t["waiting_for"] for t in client.get(f"{API}/projects/DEMO/tickets").json()["tickets"]}
    assert res()["busy"] is False and waits()[two["key"]] == []
    a.post(f"{API}/tickets/{one['key']}/move", json={"author": "artist", "status": "in_progress"})
    held = res()
    assert held["busy"] and [h["ticket"] for h in held["holders"]] == [one["key"]] and held["holders"][0]["owner"] == "artist"
    assert held["holders"][0]["since"] > 0
    assert waits()[two["key"]] == [{"resource": "gpu-box", "name": "GPU box", "held_by": [one["key"]]}]
    assert waits()[one["key"]] == []  # the holder isn't waiting on itself
    assert client.get(f"{API}/tickets/{two['key']}").json()["waiting_for"][0]["held_by"] == [one["key"]]
    a.post(f"{API}/tickets/{one['key']}/move", json={"author": "artist", "status": "testing"})
    assert res()["busy"]  # testing still holds it
    a.post(f"{API}/tickets/{one['key']}/events", data={"author": "artist", "kind": "verification", "body": "ok"})
    a.post(f"{API}/tickets/{one['key']}/move", json={"author": "artist", "status": "uat"})
    assert res()["busy"] is False and waits()[two["key"]] == []
    # Only a to-do waits: work already in review needs no machine, even while another holds it
    three = a.post(f"{API}/projects/DEMO/tickets", json={"author": "x", "owner": "x", "title": "Held", "resources": ["gpu-box"]}).json()
    a.post(f"{API}/tickets/{three['key']}/move", json={"author": "x", "status": "in_progress"})
    assert waits()[two["key"]] != [] and waits()[one["key"]] == []
    a.post(f"{API}/tickets/{three['key']}/move", json={"author": "x", "status": "todo"})
    a.patch(f"{API}/tickets/{three['key']}", json={"author": "x", "resources": []})
    # A machine in use can't be deleted; a free one can
    assert client.delete(f"{API}/projects/DEMO/resources/gpu-box").status_code == 409
    a.patch(f"{API}/tickets/{one['key']}", json={"author": "artist", "resources": []})
    a.patch(f"{API}/tickets/{two['key']}", json={"author": "editor", "resources": []})
    assert client.delete(f"{API}/projects/DEMO/resources/gpu-box").status_code == 200


def test_a_token_sees_only_its_own_projects_machines(client, agent):
    project(client)
    project(client, "OPS", "Operations")
    client.post(f"{API}/projects/OPS/resources", json={"key": "staging", "name": "Staging"})
    a = agent(token_for(client)["token"])
    assert a.get(f"{API}/projects/OPS/resources").status_code == 404
    assert a.get(f"{API}/projects/DEMO/resources").json()["resources"] == []
