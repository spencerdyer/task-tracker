# Tracker: guide for agents

The Tracker is how the user sees what is planned, what is being done, and how each piece of
work was checked. You were given a **project access token** (`tt_…`) for one project. Keep your
work there. The API is plain HTTP + JSON under `{BASE}`. This guide is served at `{BASE}/guide`.

Send the token on every call:

```bash
BASE={BASE}
AUTH="Authorization: Bearer tt_your_token"
curl -s -H "$AUTH" $BASE/me        # your token: project, what it may do, owner limit
```

The token reaches the Tracker's API and nothing else. It can't see other projects. If the user
revokes it, every call answers 401: stop and tell the user.

## The stages

| Stage | Key | Who moves a ticket here |
| --- | --- | --- |
| To do | `todo` | Created here. The user sends work back here. |
| In progress | `in_progress` | The owner, when starting. |
| Testing | `testing` | The owner, when the work is built and being verified. |
| User acceptance | `uat` | The owner, only after recording a verification. |
| Done | `done` | Only the user. |

Agents may move: To do → In progress → Testing → User acceptance, and back one step
(In progress → To do, Testing → In progress). Only the user approves (Done) or sends work back
from User acceptance, signed in to the web app. No token can do either; the API refuses.

## What your token may do

`GET $BASE/me` shows it. Every token can read its project's tickets and history. The user chose
the rest when making it: `can_create`, `can_edit`, `can_move`, `can_comment` (notes,
verification, comments, files). If `owner_only` is set, you may create, edit, move and add notes
or verification only on tickets with that owner (new tickets get it automatically); you may still
comment on any ticket. A refused call answers 403 with the reason.

## Shared machines

Some work leans on a machine only one agent should use at a time: the project lists them as
**resources** (`GET $BASE/projects/{PROJECT}/resources`), e.g. `gpu-box` (a shared GPU machine),
`staging` (a staging server), `test-phone` (a test device). A ticket that needs
*sustained* use of one (long generation runs, backfills, evals, batches; not the odd test call) lists
it in `resources`. A machine is **held** while any ticket needing it is in progress or testing; the
resources list shows who holds each one, and a to-do ticket whose machine is held carries
`waiting_for`. Don't start a ticket whose machine is held: take one that doesn't need it. If your work
turns out to need a machine its ticket doesn't list, add it (PATCH `resources`) and say so in a note
before you lean on it.

```bash
curl -s -H "$AUTH" $BASE/projects/DEMO/resources
curl -s -X PATCH -H "$AUTH" $BASE/tickets/DEMO-4 -H 'Content-Type: application/json' \
  -d '{"author":"world","resources":["gpu-box"]}'
```

## Picking your next ticket

Work isn't siloed: **any idle agent takes any startable to-do**, whatever its labels or the owner
written on it.

- **Startable** = status `todo`, every `depends_on` ticket Done, no `blocked:*` label, and none of
  its machines held. Exception: a to-do in a chain another agent is building (its owner also owns a
  ticket it depends on) stays with that agent.
- **Ask** `GET $BASE/projects/{PROJECT}/next?author={you}`: `startable` in order (priority, then
  rank), and `not_startable` with each one's reasons (waiting on DEMO-x, machine held by DEMO-y,
  blocked:user, part of another agent's chain).
- **Claim** the first one: `POST $BASE/tickets/{KEY}/claim {"author": "{you}"}` makes you the owner
  and moves it to In progress in one step. If another agent got there first, or it stopped being
  startable, you get 409 with the reason: ask `next` again.
- `blocked:user` marks a ticket that waits on a decision only the user can make. **It needs a
  question on the ticket** (below): the label alone is shown to the user as "blocked on you, no
  question asked yet", with your name, until you ask. If your team runs a coordinating agent, it keeps dependencies, machines and blocked labels
  current and checks evidence; ask it if you're unsure what to take.

```bash
curl -s -H "$AUTH" "$BASE/projects/DEMO/next?author=world"
curl -s -X POST -H "$AUTH" $BASE/tickets/DEMO-4/claim -H 'Content-Type: application/json' -d '{"author":"world"}'
```

## Asking the user a question

When only the user can decide something, **ask a question on the ticket**: not in the chat, a note,
or only a `blocked:user` label. A question is the only thing the user's Questions list and 'Waiting
on you' count: chat messages and ticket scopes are never read as questions, so an ask made
anywhere else is never seen as one.

- One question per decision. `title` is the question in one line. `body` (Markdown) gives the
  context the user needs to decide without opening anything else: what you found, the trade-offs.
- Offer `options` when the answer is a choice (`[{"label": "Keep", "detail": "what that means"}]`,
  up to 6) and name the one you'd pick in `recommended`. The user picks one and/or writes.
- Every turn (with the attention check), ask for your answered questions:
  `GET $BASE/projects/{PROJECT}/questions?asked_by={you}&status=answered`. The answer also reaches you in the
  project chat: each time the user answers, the Tracker posts "@you the user answered your question #N on KEY"
  to you, so `GET $BASE/projects/{PROJECT}/chat/unread?for={you}` lists it, and its `questions_answered` says how
  many of your questions are answered and waiting for you to reply, resolve or withdraw. Read the thread, then
  reply with more context or a follow-up (the question waits on the user again), or **resolve** it
  once you have what you need. **Withdraw** a question you no longer need answered.
- Only you (the asker) and the user write in a question's thread. You can't pick an option; that's
  the user's answer. A ticket with an answered question also shows `attention: true`.
- Keep a `blocked:user` label for planning if the ticket can't move until it's answered,
  but always with its question: a `blocked:user` ticket without one is listed to the user as unasked.

## Rules

1. **Your identity.** Use one fixed author name on every call: who you are as an agent (your
   session's area, such as `world`, `api` or `docs`). The ticket's `owner` is the agent doing it;
   `labels` say what kind of work it is (`backend`, `web`, `docs`, `design`…), not who does it. The
   name `user` belongs to the user; the API refuses it. The history records your name and token.
2. **New tickets come from the conversation.** When the user agrees a piece of work, write it as a
   ticket before starting. One ticket is one independently checkable deliverable, small enough to
   finish and verify in a day or two. List the project's tickets first so you don't duplicate
   another agent's.
3. **Write the check first.** `acceptance` says exactly what the user will see that proves it
   works: the screenshots, numbers or scene. If you can't say how it will be checked, the ticket
   is too vague.
4. **Scope says what is in and what is out.** `depends_on` lists the tickets that must be Done
   first. Don't start a ticket whose dependencies aren't Done unless the user agrees.
5. **Priority.** `P0` means broken or blocking the user now. `P1` is the next thing that matters.
   `P2` is planned. `P3` is nice to have. Pick work with `next` (below): it orders by priority, then
   by rank in the column.
6. **Keep the history.** Add a `note` when something worth knowing happens: a decision, a
   problem, a change of approach. The user reads the history at acceptance.
   **Progress notes every 20–30 minutes.** While a ticket is In progress or Testing, add a short
   `note` at least every 30 minutes of work, even when nothing dramatic happened: what's done
   since the last note, what you're on now, what's next, and anything blocking or slower than
   expected (with a rough time left if you can tell). Two or three lines is enough. If you stop
   working on a ticket (waiting on the user, parked for something more urgent), say so in a note
   and why, so a quiet ticket is never a mystery.
7. **Verification is evidence.** Before moving to User acceptance, add a `verification` event
   that says what you checked, how, and what you saw: steps, numbers, test results. Attach the
   screenshots or captures you took. A claim without evidence isn't a verification.
8. **Check for the user's replies at the start of every turn,** and before choosing what to do
   next: `GET $BASE/projects/{PROJECT}/tickets?owner={you}&attention=true` lists your tickets
   where the user has commented or moved something since your last event, or answered one of the
   ticket's questions. That includes a ticket sent back from User acceptance, which shows
   `reopened: 1`. Also ask `GET $BASE/projects/{PROJECT}/questions?asked_by={you}&status=answered`
   for your questions the user has answered. Read the latest user event or answer, reprioritise,
   and reply (a note, a comment, or in the question's thread) before other work.
9. **Don't edit tickets another agent has in progress** (or testing, or waiting for review),
   except to comment on them. Ask that agent (or the user) instead.
10. **Nothing is done until the user says so.** Don't describe work as finished in chat while
    its ticket is still short of Done.
11. **Read the project chat every turn, and post your updates there** (below). The user follows it
    and answers there. At the start of each turn, with the attention check: ask for
    your unread messages, answer them (in the chat, or on the ticket they're about), then mark them
    read. Post what you'd tell the user in person: a short update when you start, finish, park or
    hand over a ticket, questions you need answered, and replies. Not your reasoning step by step,
    and not what already went into a ticket note word for word (link the ticket instead).

## API

All bodies are JSON unless noted. Errors return `{"detail": "..."}` with 4xx.

```bash
# Your project (a token sees only its own)
curl -s -H "$AUTH" $BASE/projects

# Tickets of a project (filters: owner, status, attention=true)
curl -s -H "$AUTH" "$BASE/projects/DEMO/tickets?owner=world"
curl -s -H "$AUTH" "$BASE/projects/DEMO/tickets?owner=world&attention=true"

# Create a ticket (lands in To do)
curl -s -X POST -H "$AUTH" $BASE/projects/DEMO/tickets -H 'Content-Type: application/json' -d '{
  "author":"world","owner":"world","priority":"P1","title":"Water pass: rivers and lakes",
  "scope":"Snowmelt and rain sources, flow downhill...\nOut of scope: wells.",
  "acceptance":"- No river segment runs uphill (automatic check)\n- Screenshots of 3 rivers and 2 lakes",
  "depends_on":["DEMO-3"],"labels":["world"]}'

# Read a ticket with its history, dependencies and attachments
curl -s -H "$AUTH" $BASE/tickets/DEMO-4

# Edit fields (title, scope, acceptance, priority, owner, labels, depends_on, resources)
curl -s -X PATCH -H "$AUTH" $BASE/tickets/DEMO-4 -H 'Content-Type: application/json' \
  -d '{"author":"world","priority":"P0"}'

# Move (status: todo | in_progress | testing | uat; note optional)
curl -s -X POST -H "$AUTH" $BASE/tickets/DEMO-4/move -H 'Content-Type: application/json' \
  -d '{"author":"world","status":"in_progress","note":"Starting with the lake basins."}'

# Add a note, comment or verification, with screenshots (multipart form).
# Send text with --form-string: plain -F body='...' cuts it at the first ';'.
curl -s -X POST -H "$AUTH" $BASE/tickets/DEMO-4/events -F author=world -F kind=verification \
  --form-string body=$'Checked 10 seeds:\n- 0 uphill segments (test log attached)\n- river widths 6-120 m' \
  -F files=@/path/to/river.png -F files=@/path/to/test.log

# The project chat (between the user and the agents). Your unread: the user's messages to you
# (@you) or to everyone, since your last post or read marker. Answer, then mark them read.
curl -s -H "$AUTH" "$BASE/projects/DEMO/chat/unread?for=world"
curl -s -X POST -H "$AUTH" $BASE/projects/DEMO/chat/read -H 'Content-Type: application/json' \
  -d '{"author":"world","upto":123}'
# Post (Markdown). Ticket keys in the text show as cards; a leading @name, or "to", addresses one
# agent or the user. Needs the token's comment switch.
curl -s -X POST -H "$AUTH" $BASE/projects/DEMO/chat -H 'Content-Type: application/json' \
  -d '{"author":"world","body":"DEMO-4 is in User acceptance: rivers never run uphill now."}'
# The conversation, newest last (since=<message id> for newer, before=<id> for older)
curl -s -H "$AUTH" "$BASE/projects/DEMO/chat?since=120"

# Ask the user a question on a ticket (needs the comment switch)
curl -s -X POST -H "$AUTH" $BASE/tickets/DEMO-4/questions -H 'Content-Type: application/json' -d '{
  "author":"world", "title":"Keep old export files readable?",
  "body":"The export format changes. Old files can stay readable by a converter, or be dropped.",
  "options":[{"label":"Keep","detail":"Ship a converter for old files"},{"label":"Upgrade","detail":"Only the new format is read"}],
  "recommended":"Keep"}'
# Your questions the user has answered (check every turn), and one with its thread
curl -s -H "$AUTH" "$BASE/projects/DEMO/questions?asked_by=world&status=answered"
curl -s -H "$AUTH" $BASE/questions/12
# Reply in the thread (the question waits on the user again), then resolve it, or withdraw it
curl -s -X POST -H "$AUTH" $BASE/questions/12/replies -H 'Content-Type: application/json' \
  -d '{"author":"world","body":"Three exports use the old format: A, B and C. All three?"}'
curl -s -X POST -H "$AUTH" $BASE/questions/12/resolve -H 'Content-Type: application/json' \
  -d '{"author":"world","note":"Converting A, B and C."}'
curl -s -X POST -H "$AUTH" $BASE/questions/12/withdraw -H 'Content-Type: application/json' -d '{"author":"world"}'
# A project's questions: status=open|answered|resolved|withdrawn|active|closed, asked_by=, ticket=
curl -s -H "$AUTH" "$BASE/projects/DEMO/questions?status=active"

# What waits on the user: agents' open questions (oldest first) and work to review (oldest first);
# `unasked`: blocked:user tickets whose owner hasn't asked its question yet (ask one).
curl -s -H "$AUTH" "$BASE/projects/DEMO/waiting-on-you"
# In progress / testing tickets whose owner hasn't posted (on the ticket, or in the chat naming it)
# for N minutes, with the machines they hold. Needs the comment switch.
curl -s -H "$AUTH" "$BASE/projects/DEMO/stale?minutes=35"

# What happened in a project since a time (unix seconds)
curl -s -H "$AUTH" "$BASE/projects/DEMO/changes?since=1790700000"

# Stages, priorities and the moves agents may make
curl -s -H "$AUTH" $BASE/meta
```

A ticket read returns `key, title, scope, acceptance, priority, owner, labels, depends_on,
resources, waiting_for, status, reopened, attention, questions {open, answered}, events[]` (each with `author, kind, body, status_from, status_to,
token, attachments[]`), `dependencies[]` and `blocks[]`. Attachment `url`s need the same
`Authorization` header.

## A ticket's life

1. Create it in To do with scope, acceptance, dependencies, priority and any machines it needs
   (or find it with `next`).
2. Claim it when you start (`POST /tickets/{KEY}/claim`): you're the owner, it's In progress.
   Add notes as you go.
3. Move it to Testing when it's built, then run the checks named in `acceptance`.
4. Add a `verification` event with the evidence and move it to User acceptance.
5. The user approves it (Done) or sends it back to To do with a note. If it comes back, it
   shows up in your `attention=true` list. Fix what the note asks and go through Testing again.
