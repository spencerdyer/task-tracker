#!/usr/bin/env bash
# Scan the tree for things that must not be published:
#   1. secrets, with gitleaks (tracked files and git history);
#   2. private details, with grep: private and Tailscale IP addresses, home folders, token shapes,
#      email addresses;
#   3. optionally, words listed one per line in $SCRUB_WORDS_FILE (names, project names, hostnames…).
#      Keep that file OUTSIDE the repository: a list of private words would itself publish them.
# Exits 1 if anything is found. Usage: scripts/scrub_scan.sh [path, default: the repository]
set -uo pipefail
ROOT=${1:-$(cd "$(dirname "$0")/.." && pwd)}
cd "$ROOT"
found=0
EXCLUDE=(--exclude-dir=node_modules --exclude-dir=.venv --exclude-dir=dist --exclude-dir=.git
         --exclude-dir=data --exclude-dir=.pytest_cache --exclude-dir=__pycache__ --exclude=package-lock.json)

section() { printf '\n== %s\n' "$1"; }

section "gitleaks"
if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks detect --source . --no-banner --redact; then echo "no leaks found"; else found=1; fi
  if gitleaks dir . --no-banner --redact >/dev/null 2>&1; then echo "working tree: no leaks found"
  else gitleaks dir . --no-banner --redact; found=1; fi
else
  echo "gitleaks is not installed: https://github.com/gitleaks/gitleaks (this check is required in CI)"
  [ -n "${CI:-}" ] && found=1
fi

scan() {  # name, extended regex
  section "$1"
  local out
  out=$(grep -rInE "${EXCLUDE[@]}" "$2" . | grep -v "scripts/scrub_scan.sh" || true)
  if [ -n "$out" ]; then echo "$out"; found=1; else echo "none"; fi
}

scan "private IP addresses" '(^|[^0-9.])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3})([^0-9]|$)'
scan "home folders" '(/Users/[A-Za-z]|/home/[a-z][a-z0-9_-]*/|C:\\Users\\)'
scan "token shapes" '\b(tt_|tts_)[A-Za-z0-9_-]{20,}'
scan "email addresses" '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(com|net|org|io|dev|me|co|uk|de|cloud)\b'

if [ -n "${SCRUB_WORDS_FILE:-}" ]; then
  section "private words (from \$SCRUB_WORDS_FILE, not printed)"
  if [ ! -r "$SCRUB_WORDS_FILE" ]; then echo "can't read \$SCRUB_WORDS_FILE"; found=1
  else
    hits=$(grep -rIilwF "${EXCLUDE[@]}" -f <(grep -v '^\s*$' "$SCRUB_WORDS_FILE") . || true)
    if [ -n "$hits" ]; then echo "matches in:"; echo "$hits"; found=1; else echo "none"; fi
    if [ -d .git ] && git log --all -p | grep -iwqF -f <(grep -v '^\s*$' "$SCRUB_WORDS_FILE"); then
      echo "matches in git history"; found=1
    fi
  fi
fi

section "result"
if [ "$found" = 0 ]; then echo "clean"; else echo "FOUND SOMETHING: see above"; fi
exit "$found"
