API = "/api/tracker"


def test_owner_setup_sign_in_and_a_ticket(client, anon, agent):
    assert anon.get(f"{API}/projects").status_code == 401
    assert client.get("/api/auth/status").json() == {"setup_needed": False, "signed_in": True}
    assert client.post(f"{API}/projects", json={"key": "DEMO", "name": "Demo"}).status_code == 200
    tok = client.post(f"{API}/projects/DEMO/tokens", json={"name": "agents"}).json()
    assert tok["token"].startswith("tt_")
    a = agent(tok["token"])
    t = a.post(f"{API}/projects/DEMO/tickets", json={"author": "builder", "title": "First"}).json()
    assert t["key"] == "DEMO-1"
    assert a.post(f"{API}/tickets/DEMO-1/move", json={"author": "builder", "status": "in_progress"}).status_code == 200
