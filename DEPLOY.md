# Deploying (free)

One account, one blueprint, roughly ten minutes. Everything below is on free tiers.

## Render — database, API and web together

1. Sign in at [render.com](https://render.com) with GitHub.
2. **New → Blueprint**, pick `priyadershi-antino/appointment_booking`.
3. Render reads [`render.yaml`](render.yaml) and provisions three things: a Postgres
   database, the API, and the web client. It wires `DATABASE_URL` in itself and generates
   both JWT secrets. Click **Apply**.
4. Wait for the first deploy. Two values could not be known in advance, because each
   service needs the other's URL. Fill them in now:

   | Service | Variable | Value |
   |---|---|---|
   | `booking-api` | `FRONTEND_URL` | `https://booking-web-xxxx.onrender.com` |
   | `booking-web` | `NEXT_PUBLIC_API_URL` | `https://booking-api-xxxx.onrender.com/api/v1` |

5. Redeploy both services. `NEXT_PUBLIC_API_URL` is compiled into the browser bundle, so
   the web service needs a **rebuild**, not just a restart.

6. Seed the demo data once — Render dashboard → `booking-api` → **Shell**:

   ```bash
   npm run db:seed --workspace=@booking/api
   ```

Then open the web URL. Sign in at `/login` with `admin@example.com` / `Demo@12345`.

### What to expect on the free tier

- Services sleep after 15 minutes idle. The first request after a pause takes ~30 seconds
  while the container wakes. This looks like a hang; it is not.
- Render's free Postgres is deleted after 30 days. For something longer-lived, create a
  free database at [neon.tech](https://neon.tech), delete the `databases:` block from
  `render.yaml`, and set `DATABASE_URL` on the API service to Neon's connection string.

## Vercel for the web client instead

Vercel suits Next.js better and does not sleep. The API still needs Render (or Railway,
or Fly) because it is a long-running server with a database.

1. Import the repo at [vercel.com](https://vercel.com).
2. **Root Directory**: `apps/web`.
3. **Build Command**: `cd ../.. && npm run build --workspace=@booking/shared && npm run build --workspace=@booking/web`
4. **Environment**: `NEXT_PUBLIC_API_URL = https://<api>.onrender.com/api/v1`
5. On the API service, set `FRONTEND_URL` to the Vercel URL so CORS allows it.

---

## The two settings that break deployments

**`COOKIE_SAMESITE`.** The session is an httpOnly cookie. When the API and the web client
sit on different domains — which they do on every free host — the browser silently drops a
`lax` or `strict` cookie on a cross-site request. Login appears to succeed and then every
subsequent request is unauthenticated. `render.yaml` sets `COOKIE_SAMESITE=none` with
`COOKIE_SECURE=true`; both are required together and the API refuses to start otherwise.
Keep `lax` only if the API and web share an origin behind one proxy.

**`FRONTEND_URL`.** This is the CORS allowlist. If it does not exactly match the origin the
browser is on — scheme included, no trailing slash — every API call fails in the browser
while working fine from curl.

## Required environment

**API**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL 16+ with `btree_gist` available |
| `JWT_ACCESS_SECRET` | 32+ chars |
| `JWT_REFRESH_SECRET` | 32+ chars, must differ from the access secret |
| `FRONTEND_URL` | CORS allowlist; exact origin |
| `COOKIE_SECURE` | `true` in production — the app refuses to start otherwise |
| `COOKIE_SAMESITE` | `none` for split domains |
| `REDIS_URL` | Optional. Slot holds only; correctness never depends on it |

**Web**

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | Baked in at build time — changing it needs a rebuild |

## Migrations

`startCommand` runs `prisma migrate deploy` on every boot. It only applies pending
migrations and never resets, so restarts are safe.

**Never run `prisma db push` against a deployed database.** It drops the `EXCLUDE`
constraint that prevents double booking, silently and with no error.
