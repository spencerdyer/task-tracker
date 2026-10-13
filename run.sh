#!/usr/bin/env bash
# One command: set up (first time only) and start Task Tracker on http://127.0.0.1:8765
# Needs Python 3.11+ and Node 20+. Settings come from environment variables (see server/tracker/config.py).
set -euo pipefail
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
if ! "$PY" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
  echo "Task Tracker needs Python 3.11 or newer ($PY is $("$PY" --version 2>&1 || echo missing))."
  echo "Point PYTHON at one, e.g. PYTHON=python3.12 ./run.sh"
  exit 1
fi
if [ ! -x server/.venv/bin/tracker-server ]; then
  echo "Setting up the server (first run)..."
  "$PY" -m venv server/.venv
  server/.venv/bin/pip install -q --upgrade pip
  server/.venv/bin/pip install -q -e "server[test]"
fi
if [ ! -f web/dist/index.html ]; then
  echo "Building the web app (first run)..."
  (cd web && npm ci --no-audit --no-fund && npm run build)
fi
export TRACKER_DATA_DIR=${TRACKER_DATA_DIR:-$PWD/data}
if [ "${1:-}" = "--seed" ]; then
  server/.venv/bin/tracker-seed
fi
echo "Task Tracker: http://${TRACKER_HOST:-127.0.0.1}:${TRACKER_PORT:-8765}  (data in $TRACKER_DATA_DIR)"
exec server/.venv/bin/tracker-server
