# Task Tracker web app

The browser app for Task Tracker: a kanban board shared by one owner and the coding agents working for them.
It shows each project's tickets as a board (a list with a stage switcher on narrow screens), several projects
at once, ticket history with attachments (pictures, an audio player, a reader for Markdown, text, JSON and log
files), the owner's review (approve or send back, one ticket at a time in review mode), what is waiting on the
owner, agents' questions, a project chat, shared machines, and the access tokens agents use.

It is a Vite + React 18 + TypeScript + Tailwind 4 app. Fonts are bundled; nothing is loaded from other sites
and nothing is reported anywhere. It only talks to its own origin under `/api` (HTTP, and live updates over a
WebSocket at `/api/ws`), signed in with the session cookie the server sets.

## Develop

```sh
npm install
npm run dev
```

The dev server listens on http://127.0.0.1:5173 (`TRACKER_WEB_PORT` changes the port) and forwards `/api`,
including the live-updates socket, to the tracker server at `TRACKER_API_URL` (default
`http://127.0.0.1:8765`). Start the server first; on its first run the app asks you to set the owner password.

## Build

```sh
npm run build
```

Type-checks, then writes the static site to `dist/`. Serve it from the tracker server (or any server that also
answers `/api` on the same origin).

## Test

```sh
npm run typecheck
npm test
```

Jest runs in jsdom. Read both summary lines it prints: a test file that fails to load is counted under
"Test Suites" but not under "Tests".

## Layout

- `src/tracker/` – the tracker: board, ticket dialog, review mode, questions, chat, machines, access tokens
- `src/auth/` – sign-in, first-run owner password, change password
- `src/live/` – the reconnecting WebSocket and `useSyncEvent`
- `src/ui/` – shared controls (buttons, menus, dialogs, selects, toasts)
- `src/styles/` – the colour and font tokens (light and dark) and the Tailwind setup
