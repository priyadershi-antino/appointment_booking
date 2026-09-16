# Meridian Booking System — Feature Report (plain-English crib sheet)

Use this to explain the project out loud. Section 1 is the 60-second pitch.
Sections 2-8 are the features. Sections 9-11 are the "hard questions" ammo.

---

## 1. One-paragraph pitch

Meridian is an appointment booking system. A customer picks a service, sees only the
times that are genuinely free, and books in under a minute — no account needed. Staff
get an admin console with a calendar, appointment list, working-hours editor and
analytics. The interesting part is not the screens, it is the **booking engine**: all
availability is decided by the backend, and double booking is made physically impossible
by the database itself, not by careful application code.

**Shape:** a modular monolith — one API process with clean internal module boundaries,
one web client. Not microservices (deliberate: the whole booking write is one tight
transaction; splitting it would buy complexity and lose the guarantee).

---

## 2. Tech stack (know these names)

| Layer | Tech |
|---|---|
| API | Node 20+, TypeScript, Express 5, Prisma 7 ORM |
| Database | PostgreSQL 18 (uses the `btree_gist` extension) |
| Cache (optional) | Redis — slot holds only; the app runs fine without it |
| Web | Next.js 16 (App Router), React 19, Tailwind CSS 4, Recharts |
| Shared | `packages/shared` — Zod schemas, enums, error codes: the API contract written once, used by both sides |
| Auth | JWT access token + rotating refresh token, both in httpOnly cookies; bcrypt passwords |
| Testing | Vitest — **75 tests, all passing** |
| Deploy | Render blueprint (`render.yaml`) — database + API + web on free tiers |

**Repo layout:** npm workspaces monorepo — `apps/api`, `apps/web`, `packages/shared`.

---

## 3. Customer-facing features

- **Service catalog** — browse services with price, duration, location type
  (in-person / online / phone) and category.
- **Live availability calendar** — the month view only enables dates that actually have
  free slots; picking a date fetches the real bookable times for that day.
- **Timezone-aware** — slots are shown in the *customer's* browser timezone, while each
  provider publishes hours in *their own* timezone.
- **Choose a provider, or "any provider"** — with "any", the engine merges every eligible
  provider's free time into one list.
- **Guest booking** — no signup required. Name, email, phone, notes.
- **Custom intake questions per service** — text, dropdown, checkbox etc., configurable
  per service; the question wording is snapshotted onto the answer.
- **Instant confirmation** with a human-readable code (e.g. `APT-2026-000123`).
- **Manage-your-booking link** — the confirmation gives a secure single-use token. The
  customer views, reschedules or cancels through that token, *never* through the
  appointment ID, so nobody can find other people's bookings by changing a number.
- **Self-service cancel & reschedule**, with a reason captured, subject to policy.
- **Booking history timeline** on the manage page.
- **Light/dark theme**, responsive down to phone width.

---

## 4. Admin / provider console

- **Dashboard** — KPIs (today's bookings, total, confirmed, completed, cancelled,
  no-shows, cancellation rate, revenue, average per day), a bookings-over-time area
  chart, a status breakdown pie chart, and top services.
- **Calendar** — day / week / month views of the schedule.
- **Appointments table** — search (by code, service, customer name or email), filter by
  status / date range / service, pagination, and **CSV export**.
- **Mark outcome** — Completed or No-show.
- **Cancel or reschedule on the customer's behalf** (staff bypass the customer deadline).
- **Availability editor** — weekly working hours per weekday, multiple windows per day
  (e.g. 09:00-13:00 and 14:00-18:00 for a lunch break), and copy-a-day-to-others.
- **Time off** — vacation, sick leave, personal, ad-hoc blocks.
- **Services & providers overview** — shows the exact booking rules (duration, buffers,
  notice, horizon) the engine uses, so you can see *why* a service offers the times it does.
- **Role-scoped**: a provider only ever sees their own calendar; an admin sees everything.
  That scoping is enforced in the API, not by hiding buttons in the UI.

---

## 5. The booking engine (the heart of the project)

It is a **pure function** — no database, no Express, no clock of its own. Everything it
needs is passed in, so it can be tested exhaustively without standing anything up.

What it takes into account when generating slots:

1. **Weekly working hours** of the provider.
2. **Date overrides** — "on the 20th I work 11:00-15:00 instead". An override *replaces*
   that day's hours; it does not merge with them.
3. **Time off** and **business-wide holidays**.
4. **Existing appointments**, including their buffers.
5. **Buffers** — before/after prep time per service.
6. **Minimum notice** (e.g. can't book within 2 hours) and **maximum advance horizon**
   (e.g. nothing further than 30 days out).
7. **Daily caps** — max bookings per day for a service, and max per customer per day.
8. **Slot interval**, independent of duration: a 30-minute service can start every
   15 minutes.

**The buffer rule people get wrong** (good thing to say out loud):

- *Bookability*: the appointment itself must fit inside published working hours.
- *Occupancy*: the appointment **plus its buffers** must not touch anything busy.

So a 10-minute prep buffer before a 09:00 appointment is fine even though the clinic
opens at 09:00 — but buffers **stack** between two neighbouring appointments (the gap
needed is the first one's trailing buffer plus the second one's leading buffer).

**Pinned acceptance test:** provider Monday 09:00-17:00, 30-minute service with 10-minute
buffers, one existing booking at 10:00-10:30, 15-minute grid → exactly **24 slots**
(09:00, then 11:00 through 16:30). If anyone changes the semantics, that test breaks loudly.

---

## 6. How double booking is actually prevented (three layers)

Say this clearly — only the third one is the real guarantee.

1. **Redis slot hold** — a short TTL hold while the customer fills in the form, so the
   slot doesn't vanish under them. Purely cosmetic: the write path never reads it. If
   Redis is down, everything still works correctly.
2. **PostgreSQL advisory locks** on (provider, slot) and (provider, day), taken in sorted
   order. This serialises contenders and makes per-day caps countable — a cap can't be
   expressed as a constraint, so it needs a lock.
3. **A database EXCLUDE constraint** (`btree_gist`) on provider + the buffered time range,
   restricted to slot-occupying statuses. **This is the guarantee.** No application bug,
   stray script or manual psql session can create an overlap. Postgres raises SQLSTATE
   `23P01` and the API translates it into a clean `409 SLOT_UNAVAILABLE`.

**Proven:** six simultaneous bookings of the same slot → one `201`, five `409`.

Two details worth mentioning:

- The range uses **half-open bounds** `[)`, so back-to-back appointments (one ends 14:30,
  the next starts 14:30) are legal. Closed bounds would wrongly reject them.
- The buffered columns are computed by a **database trigger**, not by app code, so no
  insert can sneak in a narrower range than its buffers imply.
- Cancelled and rescheduled rows are kept (history is never destroyed) but are excluded
  from the constraint, so they stop blocking the slot the instant their status changes.

---

## 7. Data & correctness design choices (each has a "why")

- **Snapshots on appointments** — service name, duration, buffers and price are copied
  onto the appointment row at booking time. Editing the catalog next month must not
  rewrite last month's history.
- **Soft deletion** — providers and services with history are deactivated, never deleted.
- **Append-only history** — a DB trigger rejects UPDATE and DELETE on the appointment
  history table. An audit trail that can be quietly rewritten isn't one.
- **Explicit state machine** — PENDING, CONFIRMED, CANCELLED, COMPLETED, NO_SHOW,
  RESCHEDULED, with a legal-transition table that also says *who* may make each move.
  No code path assigns a status directly.
- **Reschedule ordering** — the old appointment is retired to RESCHEDULED *before* the new
  one is inserted, inside one transaction. The reverse order makes an appointment collide
  with its own still-active self, which would break the commonest case: "move it 15 minutes."
- **Transactional outbox** — notification rows are written *inside* the booking
  transaction, so a committed booking always eventually notifies and a rolled-back one
  never does. A background worker drains them with `FOR UPDATE SKIP LOCKED` (safe with
  multiple API instances), retries, and dead-letters after 5 attempts.
- **Email behind an interface** — console or file provider in development; swapping in
  Resend/SES/SendGrid is one new file, and no booking code changes.
- **Injected clock** — every time-dependent rule takes `now` as a parameter, and an ESLint
  rule forbids reading the system clock anywhere except `lib/clock.ts`. That is what makes
  notice windows, deadlines and DST behaviour testable.
- **Configurable cancellation policies** — per service: whether cancellation/reschedule is
  allowed, the deadline in minutes, and a max number of reschedules. Deadlines are
  enforced server-side; the UI displays them for honesty but never decides them.
- **Audit log** — who did what to which record, with IP and user agent.

---

## 8. Timezones & daylight saving (a strong talking point)

- Recurring availability is stored as **local wall-clock minutes + IANA timezone**, never
  as UTC, and expanded per calendar date. Appointment instants are stored in UTC.
- **Spring forward** — a wall time in the missing hour doesn't exist: window edges clamp
  forward and grid points inside the gap are dropped.
- **Fall back** — an ambiguous wall time happens twice: the **earlier** occurrence always
  wins, everywhere, so a slot you displayed and the booking written a minute later agree.
- Tested across four zones, both hemispheres. The seed data deliberately places one
  provider in New York so the DST paths are exercised by the demo, not only by tests.

---

## 9. Security, reliability & ops

- **Auth**: JWT access token + opaque rotating refresh token, both httpOnly cookies.
  Refresh tokens are stored only as SHA-256 hashes, and belong to a "family" — presenting
  an already-rotated token is treated as theft and revokes the entire family.
- **Login timing safety** — an unknown email is still compared against a dummy hash, so
  response timing doesn't reveal which addresses are registered.
- **RBAC by capability, not role name** — routes check `appointments.cancel`, not
  `role === 'ADMIN'`. Roles expand to permission sets stored in the database, so changing
  who may do what is a data change, not a code change. Ownership ("may they do it to
  *this* record") is a separate check in the service layer.
- **Rate limiting** — a global ceiling; a tighter one on booking (unauthenticated and it
  creates real records); a strict one on login keyed on IP **and** the email being tried,
  so a password spray can't be spread across many addresses from one host.
- **Validation** — every body, query and route param validated with Zod schemas shared
  with the frontend.
- **One response envelope** for everything: `{ success, data, message }` or
  `{ success: false, error: { code, message } }`, with typed error codes.
  `400` validation · `401` auth · `403` permission · `404` missing · `409` conflict ·
  `422` business rule · `429` rate limit · `500` server.
- **Hardening**: Helmet, CORS allow-list with credentials, compression, 256 KB body cap,
  `x-powered-by` disabled, trust-proxy set so the rate limiter sees real client IPs.
- **Observability**: a request ID on every request, echoed back in the response;
  structured JSON logging (pino).
- **Health endpoints**: `/health` (liveness — deliberately no dependency checks, so a DB
  blip doesn't get a healthy process killed) and `/ready` (readiness — checks the database;
  reports Redis but does not fail on it, because nothing depends on Redis for correctness).
- **Background jobs**: outbox drainer, expired-hold sweeper (releases PENDING slots),
  auto-complete for past visits.
- **Graceful shutdown** on SIGTERM/SIGINT with a 10-second force-exit backstop, because a
  booking transaction interrupted mid-commit is exactly what leaves a customer with a
  confirmation and no appointment.
- **Seed data** — realistic demo: admin/provider/customer logins, multiple services and
  providers, holidays, time off, intake questions.

---

## 10. Likely questions → short answers

**"How do you prevent double booking?"**
Three layers, and only the database one is the guarantee: a Postgres EXCLUDE constraint on
provider + buffered time range. Redis holds are cosmetic; advisory locks serialise
contenders and make daily caps countable. Verified: 6 concurrent requests → 1 success,
5 conflicts.

**"Why not just check for conflicts before inserting?"**
Because between the check and the insert, another transaction can commit. A read-then-write
check is a race by construction. A constraint can't be raced.

**"Why is the slot engine a pure function?"**
It's the one place where being wrong is expensive and silent. Pure means testable without a
database, a server or a real clock — hence 75 fast tests covering DST, buffers, caps and
boundaries.

**"Why is Redis optional?"**
Because if the write path trusted holds, Redis availability would become a *correctness*
dependency. The test setup deliberately deletes `REDIS_URL` to prove the system is correct
without it.

**"Why a monolith?"**
The booking write is one transaction across appointment + history + outbox. Splitting that
across services would mean distributed transactions to buy back a guarantee Postgres gives
me for free today. The module boundaries are already clean, so extracting later is cheap.

**"What would you do next?"**
Payments (the `PENDING → CONFIRMED` path and a `paymentMode` field already exist, so it
slots in without reshaping the domain); external calendar sync (purely additive — one more
busy-time source feeding the engine); multi-tenancy; and wiring the idempotency-key table
into `POST /appointments` (the table is modelled, not yet wired up). All consciously
deferred to keep v1 focused on the booking loop.

**"What's the weakest part?"**
Services and providers are read-only in the admin UI today — they're managed through the
seed/database. And integration tests against a live database are thinner than the domain
unit tests.

---

## 11. Numbers to remember

- **75 tests**, 3 test files, all passing in ~1.2 seconds
- **6 concurrent bookings → 1 success, 5 × HTTP 409**
- **24 slots** in the pinned acceptance case
- **3 roles** (Admin, Provider, Customer), ~30 granular permissions
- **6 appointment statuses**, **3-layer** double-booking defence
- **~25 REST endpoints** under `/api/v1`
- Demo logins: `admin@example.com` / `provider@example.com` / `customer@example.com`,
  password `Demo@12345`

---

## 12. 60-second demo path (if they ask you to show it)

1. Home page → service catalog.
2. Pick a service → calendar shows only dates with real availability.
3. Pick a date → real slots, in your browser's timezone. Point out a gap where an
   existing booking plus buffers removed times.
4. Book as a guest → instant confirmation + manage link.
5. Open the manage link → reschedule, then cancel. Point out the policy deadline.
6. Sign in as admin → dashboard KPIs and charts, calendar, appointments table with
   search/filter/CSV, availability editor, add time off.
7. Refresh the booking page → the time you blocked is gone.
