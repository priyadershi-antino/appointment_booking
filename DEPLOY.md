# Deploying

Current setup: **Vercel** (web) → **Render** (API) → **Supabase** (Postgres).

## Do I need Redis?

**No.** Leave `REDIS_URL` unset.

Redis is an accelerator here, never a dependency. It backs slot holds and nothing else,
and the booking write path never reads it — the guarantee against double booking is a
PostgreSQL exclusion constraint, which is unaffected by Redis being absent, slow or
offline. The test suite deletes `REDIS_URL` before every run specifically to keep that
true, so "works without Redis" is a standing, enforced property rather than a claim.

If `REDIS_URL` is set but unreachable, `/ready` reports `"redis":"down"`. That is worse
than not setting it at all: it looks like a fault, and it is not one. Delete the variable
and it reads `"not configured"`, which is the correct state.

Add Redis later only if you run several API instances and want slot holds shared between
them. Nothing else changes.

---

## Supabase → Render

Supabase offers three connection strings, and the choice matters more than it looks.

| Supabase calls it | Port | Use it for |
|---|---|---|
| Direct connection | 5432 | **IPv6 only.** Render cannot reach it — avoid |
| Session pooler | 5432 | **Use this.** IPv4, supports DDL, so migrations work |
| Transaction pooler | 6543 | Fine for queries, **cannot run migrations** |

Find them under **Project Settings → Database → Connection string**.

### The simple setup

Use the **Session pooler** for everything. It is IPv4-reachable and supports the prepared
statements and session state that DDL needs, so one variable covers both runtime and
migrations:

```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

### The high-traffic setup

If you later move runtime traffic onto the transaction pooler for connection efficiency,
migrations must keep using a connection that can run DDL:

```
DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&sslmode=require
DIRECT_DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

The Prisma CLI uses `DIRECT_DATABASE_URL` when present; the running app always uses
`DATABASE_URL`.

> `sslmode=require` is not optional — Supabase refuses plaintext connections. A missing
> `sslmode` is one of the two most common causes of a database that reports `down` with
> no obvious reason. Check `/ready`, which now names the failure.

### One extension is required

The overlap guard needs `btree_gist`. The migration creates it, but the role must be
allowed to. If `migrate deploy` fails on the extension, run this once in the Supabase SQL
editor and redeploy:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

---

## Render — API service

**Environment**

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase session pooler string, with `?sslmode=require` |
| `JWT_ACCESS_SECRET` | 32+ random characters |
| `JWT_REFRESH_SECRET` | 32+ random characters, **different from the access secret** |
| `FRONTEND_URL` | `https://appointment-booking-web-black.vercel.app` |
| `COOKIE_SECURE` | `true` |
| `COOKIE_SAMESITE` | `lax` — see below |
| `NODE_VERSION` | `22` |
| `REDIS_URL` | **remove it** |

**Build command**

```bash
npm ci --include=dev && \
npm run build --workspace=@booking/shared && \
npm run db:generate --workspace=@booking/api && \
npm run build --workspace=@booking/api
```

The Prisma client is generated as TypeScript, so it must be generated *before* the
TypeScript build, not after.

`--include=dev` matters: with `NODE_ENV=production` set, plain `npm ci` silently skips
devDependencies — which is where `typescript` and every `@types/*` package live — and the
build fails with `TS7016` on every third-party import (express, cors, jsonwebtoken, …).

**Start command**

```bash
npm run db:migrate:deploy --workspace=@booking/api && npm run start --workspace=@booking/api
```

`migrate deploy` only applies pending migrations and never resets, so it is safe on every
boot — and it is what installs the exclusion constraint that prevents double booking.

**Seed once**, from the Render shell:

```bash
npm run db:seed --workspace=@booking/api
```

---

## Vercel — web app

| Variable | Value |
|---|---|
| `API_PROXY_TARGET` | `https://appointment-booking-q4j2.onrender.com` |
| `NEXT_PUBLIC_API_URL` | `/api/v1` — relative, deliberately |
| `INTERNAL_API_URL` | `https://appointment-booking-q4j2.onrender.com/api/v1` |

**Build command**

```bash
cd ../.. && npm run build --workspace=@booking/shared && npm run build --workspace=@booking/web
```

with **Root Directory** set to `apps/web`.

### Why `NEXT_PUBLIC_API_URL` is relative

The browser talks only to the Vercel origin, and Next proxies `/api/v1` through to Render
server-side. That keeps the session cookie **first-party**, which is the only arrangement
that works everywhere: a cookie set by `onrender.com` on a page served from
`vercel.app` is a third-party cookie, blocked outright by Safari and by default in
Chrome. Login would appear to succeed and every request after it would be
unauthenticated.

It also removes CORS from the picture entirely, and means `COOKIE_SAMESITE=lax` is
correct — `none` is only needed if you deliberately point the browser straight at the API
domain.

---

## Diagnosing

```bash
curl https://appointment-booking-q4j2.onrender.com/ready
```

- `{"ready":true,"checks":{"database":"up","redis":"not configured"}}` — correct.
- `"database":"down"` — the response now includes `databaseError` naming the cause, with
  the password stripped. Usually a missing `sslmode=require`, the IPv6-only direct
  connection, or a wrong password.
- `"redis":"down"` — `REDIS_URL` is set but unreachable. Remove it.

A 500 from `/api/v1/services` while `/health` returns 200 means the process is alive but
cannot reach Postgres — `/health` is deliberately dependency-free so a database blip does
not cause an orchestrator to kill an otherwise healthy instance.

**Never run `prisma db push` against a deployed database.** It drops the `EXCLUDE`
constraint that prevents double booking, silently and with no error.

---

## Auto-deploy vs PR previews

Two separate Render features that are easy to conflate.

**Auto-Deploy** is the one that rebuilds when you push. It lives under
**Settings → Build & Deploy → Auto-Deploy** and is on by default for a GitHub-connected
service, so `git push origin main` already triggers a build and redeploy. It is pinned to
`autoDeploy: true` in the blueprint so it stays explicit rather than implied.

**Pull Request Previews** are unrelated to pushing to main. They spin up a *temporary
copy* of the service for each open PR, so you can click a link and test a branch before
merging, then tear it down when the PR closes. Nothing about them affects your main
deploy.

They are switched **off** here, on purpose:

> The API's start command runs `prisma migrate deploy` on every boot. A preview instance
> inherits this service's environment, including `DATABASE_URL`. So opening a PR that adds
> a migration would apply that migration to the **real Supabase database** as soon as the
> preview booted — before anyone reviewed the PR. Worse, a preview of a *reverted* branch
> could apply an older schema.

Previews become genuinely useful once each one gets its own throwaway database. Render's
**Preview Environments** do exactly that — they clone a group of services, database
included — but that needs a paid plan and the database defined in the blueprint rather
than hosted on Supabase. Until then, off is the correct setting.

## Free-tier notes

Render free services sleep after 15 minutes idle; the first request after a pause takes
around 30 seconds while the container wakes. That looks like a hang and is not one.
Vercel does not sleep, so the web app stays fast and the API is what lags on first hit.
