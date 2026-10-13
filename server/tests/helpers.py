"""Small helpers shared by the tracker tests."""
from __future__ import annotations

API = "/api/tracker"


def project(client, key="DEMO", name="Demo"):
    res = client.post(f"{API}/projects", json={"key": key, "name": name})
    assert res.status_code == 200, res.text
    return client


def token_for(client, project="DEMO", **fields):
    body = {"name": "agents", **fields}
    res = client.post(f"{API}/projects/{project}/tokens", json=body)
    assert res.status_code == 200, res.text
    return res.json()
