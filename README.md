# Meridian — Appointment Booking System

A production-shaped appointment booking system: service catalog, provider availability,
a backend slot-generation engine, customer booking with genuine double-booking
prevention, cancellation and rescheduling under configurable policies, and an admin
dashboard.

Built as a **modular monolith** — one API process with internal module boundaries, one web
client. Not microservices.

**The core idea:** the booking engine is the product. Availability, slots, conflicts and
state transitions are decided by the backend and ultimately enforced by PostgreSQL
constraints. The browser is a client that renders answers; it never computes availability.

---

## Requirements

| | |
|---|---|
| Node | 20.19+ (24 LTS recommended — Node 20 reached end of life in April 2026) |
| PostgreSQL | 18 (16+ works; `btree_gist` must be available) |
| Redis | Optional. Used for slot holds only; the app runs fine without it |

## Setup

```bash
npm install

# Create the database
createdb booking_dev          # or: psql -U postgres -c "CREATE DATABASE booking_dev"

cp apps/api/.env.example apps/api/.env
# Set DATABASE_URL, and generate two different secrets:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

cp apps/web/.env.example apps/web/.env.local

npm run db:migrate    # applies schema + the overlap-guard migration
npm run db:seed       # realistic demo data
npm run dev           # API on :4000, web on :3000
```

**Deploying?** See [DEPLOY.md](DEPLOY.md) — a Render blueprint deploys the database, API
and web client together on free tiers.

## Demo accounts

Password for every account: **`Demo@12345`**

| Role | Email |
|---|---|
| Admin | `admin@example.com` |
| Provider | `provider@example.com` |
| Customer | `customer@example.com` |

Sign in at `/login`. Guest booking needs no account at all — book from the home page and
manage the appointment through the token link in the confirmation.

## Scripts

```bash
npm run dev            # both apps
npm run dev:api        # API only
npm run dev:web        # web only
npm run build          # shared -> api -> web
npm test               # test suites
npm run typecheck
npm run lint
npm run verify         # typecheck + lint + test
npm run db:migrate     # prisma migrate dev
npm run db:seed
npm run db:reset       # drop, re-migrate, re-seed
npm run db:studio
```

> **Never run `prisma db push` on this project.** It silently drops the exclusion
> constraint that prevents double booking, with no visible error.

---

## Layout

```
apps/api      Express + Prisma. Standalone: own package.json, own .env, own scripts.
  src/domain      the engine — pure, no Express, no Prisma, exhaustively tested
    time/           interval algebra + timezone/DST resolution
    scheduling/     slot generation
  src/modules     auth, slots, appointments, analytics, availability
  src/lib         errors, http envelope, prisma, logger, clock, redis, holds
  src/middleware  request ids, error translation, validation, auth, RBAC, rate limits
  prisma/         schema, migrations, seed

apps/web      Next.js 16 App Router. Standalone.
packages/shared   Zod schemas, enums, error codes — the API contract, defined once.
```

## How double booking is actually prevented

Three layers. Only one of them is the guarantee.

1. **Redis hold** — a short TTL hold while the customer fills in the form, so the slot
   does not vanish under them. Purely cosmetic: the write path never reads it.
2. **`pg_advisory_xact_lock`** on `(provider, slot)` and `(provider, day)`, taken in sorted
   order. This serialises contenders and makes per-day caps countable — a cap cannot be
   expressed as a constraint, so it needs a lock.
3. **A partial `btree_gist` EXCLUDE constraint** on `provider_id` plus
   `tstzrange(blockStartsAt, blockEndsAt, '[)')`, restricted to slot-occupying statuses.
   This is the guarantee. No application bug, stray script, or psql session can create an
   overlap. SQLSTATE `23P01` is translated to `409 SLOT_UNAVAILABLE`.

Verified: six simultaneous bookings of one slot → **one 201, five 409**.

## Buffers

An appointment reserves `bufferBefore + duration + bufferAfter`. Two distinct rules apply,
and conflating them is the classic bug:

- **Bookability** — `[start, start+duration]` must fit inside published working hours.
- **Occupancy** — `[start−before, start+duration+after]` must not touch anything busy.

Buffers may therefore spill outside opening hours (a 10-minute prep before a 09:00
appointment is fine), but they **stack** between neighbours: the gap needed between two
appointments is the first one's trailing buffer plus the second one's leading buffer.

The spec's acceptance case is pinned as a test: provider Monday 09:00–17:00, 30-minute
service with 10-minute buffers, existing booking 10:00–10:30, 15-minute grid → exactly
**24 slots**: `09:00`, then `11:00` through `16:30`.

## Timezones

Recurring availability is stored as **local wall-clock minutes + IANA zone**, never as UTC,
and expanded per calendar date. Appointment instants are stored in UTC. Both daylight-saving
anomalies are resolved explicitly rather than left to library defaults:

- **Spring forward** — a wall time in the gap does not exist; window edges clamp forward,
  grid points are dropped.
- **Fall back** — an ambiguous wall time occurs twice; the **earlier** occurrence always
  wins, everywhere, so a displayed slot and the booking written a minute later agree.

Covered by tests in both hemispheres.

## Testing

```bash
npm test
```

75 tests covering the engine: interval algebra, DST transitions in four zones, the pinned
24-slot acceptance case, buffer stacking, bookability vs occupancy, lunch breaks,
overrides (which *replace* a day's hours rather than merging), time off, holidays,
minimum notice, advance horizon, daily caps, and any-provider merging.

`tests/setup.ts` deletes `REDIS_URL` — the suite must pass with Redis absent, which is the
standing proof that Redis is an accelerator and never a correctness dependency.

## API

Base `/api/v1`. Every response uses one envelope:

```jsonc
{ "success": true,  "data": {}, "message": "Appointment confirmed" }
{ "success": false, "error": { "code": "SLOT_UNAVAILABLE", "message": "…" } }
```

`400` validation · `401` auth · `403` permission · `404` missing · **`409` conflict** ·
`422` business rule · `429` rate limit · `500` server.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` `/auth/login` `/auth/logout` `/auth/refresh` | httpOnly cookies, rotating refresh with reuse detection |
| GET | `/auth/me` | |
| GET | `/services` `/services/:slug` `/providers` | public |
| GET | `/availability/slots` | `serviceId`, `providerId?`, `from`, `to?`, `timezone` |
| GET | `/availability/dates` | drives the calendar's enabled days |
| POST | `/appointments` | guest or authenticated; returns a manage token |
| GET | `/appointments` | scoped by role — providers see only their own |
| GET | `/appointments/token/:token` | guest management |
| POST | `/appointments/:id/cancel` `/reschedule` `/outcome` | policy deadlines enforced server-side |
| GET | `/providers/:id/availability` · PUT same | weekly rules |
| POST | `/providers/:id/time-off` · DELETE `/time-off/:id` | |
| GET | `/analytics/summary` `/analytics/timeseries` `/audit-logs` `/holidays` | |
| GET | `/health` `/ready` | liveness / readiness |

## Deliberate design choices

- **Snapshots on appointments.** Service name, duration, buffers and price are copied onto
  the row at booking time. Editing the catalog next month must not rewrite last month's
  history.
- **Soft deletion.** Providers and services with history are deactivated, never deleted.
- **Append-only history.** A database trigger rejects `UPDATE` and `DELETE` on
  `appointment_history`. An audit trail that can be quietly rewritten is not one.
- **Reschedule ordering.** The predecessor is retired to `RESCHEDULED` *before* the
  successor is inserted, inside one transaction. The reverse order makes an appointment
  collide with its own still-active self, producing a spurious conflict on the commonest
  case — "move it fifteen minutes."
- **Transactional outbox.** Notification side effects are written inside the booking
  transaction, so a committed booking always eventually notifies and a rolled-back one
  never does.
- **Injected clock.** Every time-dependent rule takes `now` as a parameter; an ESLint rule
  forbids reading the clock outside `lib/clock.ts`. That is what makes notice windows,
  deadlines and DST behaviour testable.
- **`@prisma/adapter-pg`.** Chosen so the PostgreSQL SQLSTATE survives on the thrown error —
  without it the exclusion violation cannot be distinguished from a generic failure.

## Not built (deliberately deferred)

Payments, external calendar sync, and multi-tenancy were cut to keep the first version
focused on the booking loop. `paymentMode` remains on a service and the
`PENDING → CONFIRMED` path exists, so payment slots in behind it without reshaping the
domain. Calendar sync is purely additive — one more busy-time source feeding the engine.
