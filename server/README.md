# Task Tracker server

The FastAPI + SQLite server behind Task Tracker: the tracker API under `/api/tracker`, the owner's
sign-in under `/api/auth`, live updates on `/api/ws`, and the built web app. See the repository's
README for how to run it, and `tracker/config.py` for its settings.

```sh
python3 -m venv .venv && .venv/bin/pip install -e ".[test]"
.venv/bin/pytest
.venv/bin/tracker-server
```
