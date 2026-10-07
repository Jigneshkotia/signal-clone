# Signal Clone — Secure Messaging Platform

A functional clone of Signal Messenger: real-time one-on-one and group messaging,
delivery and read receipts, typing indicators, presence, reactions, and quoted
replies — built to match Signal Desktop's interface and behaviour.

**Encryption is simulated, not real.** See [Mocked encryption](#mocked-encryption).

---

## Contents

- [Demo accounts](#demo-accounts)
- [Running it locally](#running-it-locally)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Database schema](#database-schema)
- [API reference](#api-reference)
- [Real-time protocol](#real-time-protocol)
- [Design fidelity](#design-fidelity)
- [Mocked encryption](#mocked-encryption)
- [Testing](#testing)
- [Deployment](#deployment)
- [Assumptions and trade-offs](#assumptions-and-trade-offs)
- [What is not implemented](#what-is-not-implemented)

---

## Demo accounts

The database seeds itself on first run. Every account uses the password
`signal123`.

| Name | Phone | Username | |
|---|---|---|---|
| Jignesh Kotia | `+15550100001` | `jignesh` | **start here** — most conversations |
| Aisha Raman | `+15550100002` | `aisha` | good second window for live testing |
| Daniel Osei | `+15550100003` | `daniel` | |
| Mira Kapoor | `+15550100004` | `mira` | |
| Tomás Herrera | `+15550100005` | `tomas` | |
| Lena Fischer | `+15550100006` | `lena` | |
| Yusuf Demir | `+15550100007` | `yusuf` | |
| Priya Nair | `+15550100008` | `priya` | |

The sign-in screen lists the first three as one-tap buttons.

Seed contents: 8 users, 12 conversations (8 direct, 4 groups), 121 messages
spread over two weeks, with unread chats, reactions, quoted replies, and a mix
of delivery states.

**To see real-time behaviour**, open two browser profiles (or one normal and one
incognito window) and sign in as Jignesh in one and Aisha in the other.

---

## Running it locally

### Prerequisites

- **Python 3.10+** (3.12 recommended — current FastAPI requires ≥3.10)
- **Node.js 20+**

### Backend

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

uvicorn app.main:app --reload --port 8000
```

The database is created and seeded automatically on first boot.

- API: <http://localhost:8000>
- Interactive docs (Swagger): <http://localhost:8000/docs>
- Health: <http://localhost:8000/health>

To rebuild the demo data from scratch:

```bash
python -m app.seed --reset
```

### Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>.

> Use `localhost`, not `127.0.0.1`. Next.js dev blocks its own client chunks
> when loaded from a different host than it expects, which leaves the page stuck
> on a spinner. (`allowedDevOrigins` in `next.config.ts` permits both, but
> `localhost` is the path of least resistance.)

No environment file is needed locally — the frontend defaults to
`http://127.0.0.1:8000`. To point it elsewhere, copy `frontend/.env.example` to
`frontend/.env.local`.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript | Required by the brief |
| Styling | Tailwind CSS 4 | CSS-first `@theme`; Signal's tokens live in `globals.css` |
| Client state | Zustand | REST responses and socket frames reduce into one store, so there is no second cache to reconcile |
| Backend | FastAPI | Native async WebSockets, Pydantic schemas that double as OpenAPI docs |
| ORM | SQLAlchemy 2.x (typed `Mapped[...]`) | |
| Database | SQLite | Required by the brief |
| Real-time | Raw WebSockets | One socket per tab carries every live event |
| Auth | JWT (PyJWT) + bcrypt | |
| Tests | pytest + Starlette `TestClient` | 41 tests over services and HTTP |

---

## Architecture

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  Next.js (Vercel)           │  HTTPS  │  FastAPI (Render)            │
│                             │────────▶│                              │
│  app/      routes + layouts │   REST  │  api/routes/   HTTP layer    │
│  components/  UI            │         │        │                     │
│  store/    Zustand          │   WSS   │  services/     business logic│
│  lib/      api, socket      │◀───────▶│        │                     │
│                             │ /ws     │  models/       SQLAlchemy    │
└─────────────────────────────┘         │  realtime/     socket + fanout│
                                        └──────────────┬───────────────┘
                                                       │
                                                  SQLite file
```

### Backend layering

`routes → services → models`, enforced by what each layer is allowed to import:

- **`api/routes/`** validate input, map domain errors to HTTP status codes, and
  serialise. No business rules.
- **`services/`** hold every rule — receipt aggregation, unread counts, admin
  permissions, idempotent conversation creation. No HTTP imports, which is why
  they are directly unit-testable.
- **`models/`** are persistence only.
- **`realtime/`** calls the *same* services as the routes, so a message sent
  over the socket and one sent over REST take an identical path.

Routes stay synchronous (`def`, not `async def`) so FastAPI runs blocking
SQLAlchemy on its thread pool. Live fan-out is scheduled with `BackgroundTasks`,
which accepts async callables and runs after the response is sent. The WebSocket
handlers do the reverse: they are async and push DB work into
`run_in_threadpool`.

### Frontend state

One Zustand store (`chatStore`) owns conversations, messages, typing, and
presence. REST responses and WebSocket frames both reduce into it, so an
optimistic bubble, its server acknowledgement, and a later status change are all
handled in one place.

Sending is optimistic: a pending bubble renders immediately with a
client-generated `client_id`, and the server echo carrying the same `client_id`
replaces it rather than appending beside it.

---

## Database schema

Eight tables. SQLAlchemy creates them on startup; there is no migration tool,
which is a deliberate simplification at this size.

```
users ──┬──< contacts >──┐
        │   (directional) │
        │                 │
        ├──< conversation_members >──── conversations
        │                                    │
        ├──< messages >──────────────────────┘
        │       │ └── reply_to_id (self-referential)
        │       │
        │       ├──< message_receipts
        │       └──< reactions
        └───────────────┘
```

### `users`
`id` (uuid pk) · `phone_number` (unique, nullable) · `username` (unique,
nullable) · `display_name` · `about` · `avatar_url` · `avatar_color` ·
`password_hash` · `identity_key` · `is_online` · `last_seen_at` · `created_at`

Registration requires *either* a phone number or a username; both are unique.
That rule is enforced in the service layer because SQLite cannot express it as a
table constraint.

### `contacts`
`id` · `owner_id` → users · `contact_user_id` → users · `nickname` ·
`created_at` · **unique** (`owner_id`, `contact_user_id`)

Deliberately one-directional: A saving B does not add A to B's address book.
`nickname` lets a viewer file someone under their own name, which overrides the
displayed title for that viewer only.

### `conversations`
`id` · `type` (`direct` | `group`) · `name` · `description` · `avatar_url` ·
`avatar_color` · `created_by` · `disappear_seconds` · `created_at` ·
`updated_at` · `last_message_at` *(indexed)*

Direct and group threads share one table because every downstream feature treats
them identically; only the header UI and admin controls branch on `type`.

`last_message_at` is **denormalised** from the newest message so the chat list
sorts with a plain indexed `ORDER BY` instead of a correlated subquery over
`messages` on every load.

### `conversation_members`
`id` · `conversation_id` · `user_id` · `role` (`admin` | `member`) ·
`joined_at` · `last_read_at` · `muted_until` · `is_pinned` · `is_archived` ·
**unique** (`conversation_id`, `user_id`)

Everything below `joined_at` is each member's private view and is never visible
to other participants.

`last_read_at` is a **timestamp rather than a `last_read_message_id` foreign
key**. An FK here would close a cycle — conversations → members → messages →
conversations — that SQLite cannot resolve, because it has no
`ALTER TABLE ADD CONSTRAINT` to break it with. A timestamp also makes the unread
count a single indexed range scan.

### `messages`
`id` · `conversation_id` · `sender_id` · `body` · `type` (`text` | `system`) ·
`reply_to_id` → messages · `status` · `client_id` · `created_at` · `edited_at` ·
`deleted_at`
Indexes: (`conversation_id`, `created_at`); **unique** (`conversation_id`, `client_id`)

- `reply_to_id` is self-referential and `ON DELETE SET NULL`, so deleting a
  quoted message does not cascade into every reply to it.
- `client_id` is generated by the client. Being unique per conversation makes
  sends **idempotent**: a retry or double-submit resolves to the same row.
- `deleted_at` is a soft delete — the row survives so the bubble can render
  "This message was deleted" for everyone, as Signal does.
- `type = system` rows render as centred grey notices ("Alice added Bob").

### `message_receipts`
`id` · `message_id` · `user_id` · `delivered_at` · `read_at` ·
**unique** (`message_id`, `user_id`)

**This table is the most important design decision in the schema.**

Signal only fills the double check once *every* recipient has read a message. A
single `status` column on `messages` cannot express that for a group — it would
reflect whichever member happened to act first. So there is one row per
(message, recipient); the sender gets none. The aggregate is derived:

| Condition | Status |
|---|---|
| Row persisted, receipts created | `sent` |
| Every receipt has `delivered_at` | `delivered` |
| Every receipt has `read_at` | `read` |

`messages.status` caches that result so rendering the chat list never fans out
into receipts. `derive_status()` in `services/message_service.py` is the single
source of truth, and `tests/test_receipts.py` pins the behaviour.

Timestamps rather than booleans, so the message-details view can show exactly
when each person received and read it.

### `reactions`
`id` · `message_id` · `user_id` · `emoji` · `created_at` ·
**unique** (`message_id`, `user_id`)

One reaction per person per message, matching Signal: reacting with a different
emoji replaces, and reacting with the same one toggles it off.

### A note on timestamps

All datetime columns use a custom `UtcDateTime` type (`models/common.py`).
SQLite has no native timestamp type — it stores whatever string it is handed and
silently drops `tzinfo`. Left alone, a value written as `12:00+00:00` reads back
naive, serialises without an offset, and `new Date()` in the browser then parses
it as **local** time, shifting every message by the viewer's UTC offset. The type
decorator normalises at the boundary: UTC in, timezone-aware UTC out.

---

## API reference

All endpoints are under `/api`. Authentication is `Authorization: Bearer <jwt>`.
Full interactive docs at `/docs`.

### Auth
| Method | Path | Notes |
|---|---|---|
| `POST` | `/auth/request-otp` | Mocked. Returns the code it "sent" so the UI can prefill it |
| `POST` | `/auth/verify-otp` | Accepts only the fixed code (`123456`) |
| `POST` | `/auth/register` | Phone **or** username, plus display name and password |
| `POST` | `/auth/login` | Identifier is a phone number or username |
| `POST` | `/auth/logout` | Stateless; the client discards the token |
| `GET` | `/auth/me` | Current user |

### Users and contacts
| Method | Path | Notes |
|---|---|---|
| `PATCH` | `/users/me` | Display name, about, avatar colour |
| `GET` | `/users/search?q=` | By name, username, or phone |
| `GET` | `/users/colors` | Signal's twelve conversation colours |
| `GET` | `/contacts` | |
| `POST` | `/contacts` | Add by phone or username, with an optional nickname |
| `DELETE` | `/contacts/{id}` | |

### Conversations
| Method | Path | Notes |
|---|---|---|
| `GET` | `/conversations` | Pinned first, then by `last_message_at` |
| `POST` | `/conversations/direct` | **Idempotent** — returns the existing thread if there is one |
| `POST` | `/conversations/group` | Creator becomes the first admin |
| `GET` | `/conversations/{id}` | |
| `PATCH` | `/conversations/{id}` | Rename, description, timer (admin only) |
| `POST` | `/conversations/{id}/members` | Admin only |
| `DELETE` | `/conversations/{id}/members/{uid}` | Admin removes; anyone may remove themselves |
| `PATCH` | `/conversations/{id}/members/{uid}/role` | Promote/demote (admin only) |
| `PATCH` | `/conversations/{id}/state` | Pin, archive, mute — private to the caller |
| `GET` | `/conversations/{id}/safety-number` | Mocked pairwise fingerprint |

### Messages
| Method | Path | Notes |
|---|---|---|
| `GET` | `/conversations/{id}/messages?before=&limit=` | Keyset pagination, oldest-first |
| `POST` | `/conversations/{id}/messages` | REST fallback for sending |
| `POST` | `/conversations/{id}/read` | Mark read up to a message |
| `PUT` | `/messages/{id}/reaction` | `emoji: null` clears |
| `DELETE` | `/messages/{id}` | Soft delete; sender only |

**Pagination** is keyset, not `OFFSET`. The timeline grows at the end while you
scroll up, so an offset would skip or repeat rows as it does.

**Authorisation**: every conversation-scoped route funnels through
`get_for_user()`, which asserts membership. Non-members get `404`, not `403` —
an outsider learns nothing about whether an id exists.

---

## Real-time protocol

`GET /ws?token=<jwt>` — the token is a query parameter because the browser
`WebSocket` API cannot set request headers.

Every frame, both directions: `{ "type": string, "payload": object }`.

**Client → server**

| Type | Payload |
|---|---|
| `message.send` | `conversation_id, body, client_id, reply_to_id?` |
| `typing.start` / `typing.stop` | `conversation_id` |
| `receipt.read` | `conversation_id, up_to_message_id` |
| `reaction.set` | `message_id, emoji` (`null` clears) |
| `ping` | — |

**Server → client**

| Type | Payload |
|---|---|
| `ready` | `user_id` |
| `message.new` | the full message |
| `message.status` | `message_id, status` |
| `typing` | `conversation_id, user_id, is_typing` |
| `presence` | `user_id, is_online, last_seen_at` |
| `reaction.update` | `message_id, reactions[]` |
| `conversation.update` | the conversation, or `removed: true` |
| `error` | `code, message` |
| `pong` | — |

**Connections.** `ConnectionManager` maps `user_id → set[WebSocket]`, so several
tabs work at once. It reports presence *transitions* — `connect()` returns true
only for a user's first socket, `disconnect()` only for their last — so opening a
second tab does not broadcast a spurious "came online".

**Presence** is only sent to people who share a conversation with you. There is
no global presence feed, so your online state never leaks to strangers. Stale
`is_online` flags are cleared on boot, since a crash leaves them set.

**Delivery.** On persist, receipt rows are opened for every other member; those
currently connected are stamped delivered immediately and the sender is told.
Anything that queued while a user was offline is flushed when their socket
connects.

**Typing** is never persisted — it is stale the moment it lands. Indicators also
expire client-side on a TTL, so a dropped `typing.stop` cannot leave one stuck.

**Reconnection.** The client retries with exponential backoff (1s → 30s) plus
full jitter, so many tabs waking at once do not stampede. On reconnect it
refetches the conversation list and the open thread to close any gap in missed
frames. A `1008` close (bad token) is not retried.

**Sending** prefers the socket and falls back to REST when it is down, so a
message is never silently dropped. Both paths carry the same `client_id`, which
is what makes the fallback safe.

---

## Design fidelity

Rather than eyeballing screenshots, the design tokens were taken from
Signal-Desktop's own stylesheets (`stylesheets/_variables.scss`, `_mixins.scss`,
`_modules.scss`, `components/ListTile.scss`). They live in
`frontend/src/app/globals.css`.

| | Value | Source |
|---|---|---|
| Accent (ultramarine) | `#2c6bed` | `$color-ultramarine` |
| Left pane | `320px`, `#f6f6f6` light / `#2e2e2e` dark | `$color-gray-02` / `gray-80` |
| Header height | `52px` | `$header-height` |
| Font | Inter | `$inter` |
| Type scale | 26/20/18/14/13/12/11px | `@mixin font-*` |
| Bubble radius | `18px`, collapsing to `4px` when grouped | `.module-message__container` |
| Bubble padding | `8px` / `12px` | `$message-padding-*` |
| Bubble max width | `min(306px, …)` → `370px` → `50vw` | `.module-message__container-outer` |
| List row | `6px`/`14px` padding, radius `20px / 12px` | `ListTile.scss` |
| Avatar colours | the 12 conversation colours | `$conversation-colors` |

Behavioural details that make it feel like Signal rather than a generic chat app:

- Consecutive messages from one sender within 5 minutes **group**: the bubble
  corner facing its neighbour collapses to 4px and the margin drops 6px → 1px.
- **Status ticks** are white-on-ultramarine and distinguish read by *opacity*,
  not hue — Signal has no blue ticks. Spinner → one tick → two ticks → two solid.
- **Timestamp formats** differ by context: `10:42 AM` in bubbles; `Yesterday` /
  `Tue` / `Oct 3` in the chat list; `Today` / `Mon, Oct 5` on date dividers.
- **Typing** shows in three places at once: the chat-list preview, the header
  subtitle, and a three-dot bubble at the foot of the timeline.
- Group bubbles show the sender's name only on the first of a run and the 28px
  avatar only on the last, with the gutter reserved so the run stays aligned.
- The composer swaps the microphone for a send button the instant there is text.

Light and dark are both driven by one set of semantic tokens
(`--surface-*`, `--label-*`), so neither theme is an afterthought. The stored
preference is applied by a blocking inline script before first paint, which
avoids the white flash on load.

---

## Mocked encryption

The brief scopes out the Signal protocol, so `backend/app/core/mock_crypto.py`
reproduces only what a user can *see*:

- Every account gets a random **identity key** at registration.
- Any two identity keys derive a stable **60-digit safety number**, shown in
  Signal's 12-groups-of-5 grid. The two keys are **sorted before hashing**, so
  both participants independently compute the same number — the one property
  that makes out-of-band comparison meaningful.
- Message bodies make a reversible base64 round trip, standing in for
  encrypt/decrypt.

**This is not cryptography.** Message bodies are recoverable plaintext in the
database, there is no key exchange, no ratchet, and no forward secrecy. The UI
says so in the conversation header, the safety-number dialog, and the privacy
settings, rather than implying a guarantee that is not there.

---

## Testing

```bash
cd backend && source .venv/bin/activate
pytest -q                 # 41 tests
```

Coverage is concentrated where the logic actually is:

- **`test_receipts.py`** — the aggregation rules. That a group message stays
  `sent` until *every* member has it, reaching `read` only when everyone has
  read; that reading backfills delivery; that a solo thread does not hang.
- **`test_conversations.py`** — idempotent direct creation from either side,
  Note to Self as a distinct thread, unread counting, admin permissions, last-
  admin promotion on leave, nickname overrides, non-member access returning 404.
- **`test_messages.py`** — `client_id` idempotency, keyset pagination without
  gaps or overlaps, reaction replace/toggle, cross-conversation reply rejection,
  sender-only deletion, safety-number symmetry.
- **`test_api.py`** — registration, phone normalisation, duplicate rejection,
  401s, conversation scoping, group administration over HTTP, UTC offsets.

Two of these caught real bugs during development: `get_or_create_direct` was
returning a two-person thread when asked for a one-person Note to Self (the
`HAVING` counted only filtered members, so it needed a total-membership check
too), and `/auth/request-otp` was wrongly requiring a `code` field.

Frontend:

```bash
cd frontend
npx tsc --noEmit
npm run build
```

---

## Deployment

### Backend → Render

`render.yaml` at the repository root is a Blueprint. Point Render at the repo,
or create a Web Service manually with:

- **Root directory** `backend`
- **Build** `pip install -r requirements.txt`
- **Start** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Env**: `PYTHON_VERSION=3.12.7`, `JWT_SECRET` (generate), `ALLOWED_ORIGINS`
  (your Vercel URL)

### Frontend → Vercel

- **Root directory** `frontend`
- **Env**: `NEXT_PUBLIC_API_URL=https://<your-api>.onrender.com` and
  `NEXT_PUBLIC_WS_URL=wss://<your-api>.onrender.com`

Preview deployments work without extra CORS configuration — `app/main.py`
matches any `*.vercel.app` origin by regex.

### Free-tier caveats

Both are inherent to Render's free plan and are worth knowing before judging the
hosted demo:

1. **The service sleeps after ~15 minutes idle.** The first request afterwards
   takes roughly 50 seconds. The client surfaces this as "the server may be
   waking up" instead of a generic network error.
2. **The disk is ephemeral.** SQLite is a local file, so a redeploy or restart
   starts from an empty database. The app re-seeds on boot, so the demo is
   always usable — but anything typed during a session is lost on the next
   deploy. A persistent disk (paid) or Postgres would fix this; neither is in
   scope for an assignment that specifies SQLite.

---

## Assumptions and trade-offs

**Tokens are stored in `localStorage`, not an httpOnly cookie.** The frontend is
on `*.vercel.app` and the API on `*.onrender.com`, so a cookie would need
`SameSite=None; Secure` and still would not reach the WebSocket handshake, which
cannot send headers. This is the right call for this deployment shape and a demo
app; for anything handling real messages, an httpOnly cookie with a CSRF token
(and a short-lived ticket for the socket) would be correct.

**The connection registry is in-process.** Two backend instances would not see
each other's sockets, so this design is single-instance. Scaling out means
putting Redis pub/sub behind the same `ConnectionManager` interface — the
boundary is already in the right place.

**No migration tool.** `create_all()` on startup. Alembic is the right answer the
moment the schema has to change under live data; at this size it is ceremony.

**No rate limiting, and OTP is not a real challenge.** The mocked flow returns
the code it "sent". A real implementation would persist a hashed, expiring,
rate-limited challenge and never echo it.

**Presence and typing are best-effort.** Both are derived from live sockets, so
a hard crash can briefly misreport presence until the next connect; stale flags
are cleared on boot.

**Timing-safe login was not pursued.** Authentication skips password
verification when the user does not exist, which is observable. Equalising it is
one line but adds noise to a demo.

---

## What is not implemented

Present as explicit "Coming soon" placeholders, as the brief permits:

- Voice and video calls
- Stories
- Linked devices
- Attachments and voice messages
- Real end-to-end encryption

Scoped out and **not** stubbed:

- **Disappearing messages** are stored and displayed (the timer is settable and
  shows in the conversation header), but nothing deletes messages on expiry.
- **Keyboard shortcuts** beyond Enter to send and Escape to cancel a reply.
- Message editing, forwarding, and in-conversation search.
