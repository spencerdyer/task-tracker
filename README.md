# Task Tracker

A small self-hosted tracker where one person and the AI coding agents working for them plan, do
and verify work together.

- **Tickets move through stages**: To do → In progress → Testing → User acceptance → Done.
  Agents move their own work up to User acceptance, and only after recording a verification
  (what they checked and what they saw, with screenshots or logs attached). Only the owner approves
  (Done) or sends work back.
- **Agents use plain HTTP**: each project has access tokens with switches (create, edit, move,
  comment, limited to one owner's tickets, expiry). The server serves an agent guide at
  `/api/tracker/guide` that you can hand to an agent as-is.
- **For the owner, a web app**:
  - a board (or a list on narrow screens), with several projects at once;
  - each ticket's full history and attachments (pictures, audio, a Markdown/text/JSON/log reader);
  - review mode for approving one ticket at a time;
  - "Waiting on you", the agents' formal questions with suggested answers, and a chat per project;
  - shared machines that only one ticket at a time may hold;
  - which agent is doing what.
- **Self-contained**: FastAPI + SQLite on the server, React on the web. It contacts no other
  service and sends no telemetry. Fonts are bundled.

## Quick start

You need Python 3.11+ and Node 20+.

```sh
./run.sh            # first run sets up and builds, then serves http://127.0.0.1:8765
./run.sh --seed     # the same, after filling an empty data folder with a made-up demo board
```

On the first visit, set the owner's password (at least 8 characters). Then make a project, open
**Access**, and create a token for your agent. The token is shown once. Give the agent the token and
the guide's address.

```sh
BASE=http://127.0.0.1:8765/api/tracker
AUTH="Authorization: Bearer tt_..."
curl -s -H "$AUTH" $BASE/guide        # everything an agent needs to know
curl -s -H "$AUTH" $BASE/me           # what this token may do
```

## Configuration

Everything is set with environment variables. There are no defaults pointing at other machines.

| Variable | Default | Meaning |
| --- | --- | --- |
| `TRACKER_DATA_DIR` | `./data` | Where the database (`tracker.db`) and attachments are kept |
| `TRACKER_HOST` | `127.0.0.1` | Address to listen on (this computer only by default) |
| `TRACKER_PORT` | `8765` | Port |
| `TRACKER_SESSION_DAYS` | `30` | How long a sign-in lasts without use |
| `TRACKER_SECURE_COOKIES` | `0` | Set to `1` behind HTTPS, so the session cookie only travels over HTTPS |
| `TRACKER_ALLOWED_ORIGINS` | none | Extra browser origins allowed to call the API (comma-separated) |
| `TRACKER_WEB_DIST` | `web/dist` | The built web app to serve |

To reach it from other devices, put it behind a reverse proxy with HTTPS and set
`TRACKER_SECURE_COOKIES=1`. Don't expose plain HTTP to a network you don't trust.

## Security notes

- The owner's password is stored as a salted scrypt hash. Session and project tokens are stored as
  SHA-256 hashes, and a token is shown only once, when it's made.
- Failed sign-ins slow down per address (5 free, then 1, 2, 4… seconds, up to 15 minutes).
- Uploaded files can never run as the app:
  - every response carries `X-Content-Type-Options: nosniff`;
  - anything that isn't the app's own page or assets is served under `Content-Security-Policy: sandbox`;
  - HTML, XML and script files are served as plain-text downloads;
  - an audio or video type is believed only when the file name agrees.
- The live-update socket (`/api/ws`) only accepts a signed-in owner. Agents poll the HTTP API.

## Development

```sh
cd server && python3 -m venv .venv && .venv/bin/pip install -e ".[test]"
.venv/bin/pytest                    # server tests
.venv/bin/tracker-server            # API on :8765

cd web && npm ci
npm run dev                         # web app on :5173, forwarding /api to :8765
npm test && npm run typecheck && npm run build
```

`scripts/scrub_scan.sh` checks the tree for secrets (gitleaks) and for private details: IP
addresses, home folders, token shapes, plus any words listed in a file you name in
`SCRUB_WORDS_FILE`. Keep that file outside the repository. CI runs the same scan.

## Licence

Apache License 2.0: see `LICENSE` and `NOTICE`. Third-party licences are listed in
`docs/THIRD_PARTY.md`; header guidance is in `docs/LICENSE_HEADERS.md`.
