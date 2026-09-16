# Meridian Booking System — Detailed Project Report

*Everything this project does, explained in plain words.*

---

## Table of contents

1. [What this project is](#1-what-this-project-is)
2. [Who uses it](#2-who-uses-it)
3. [How the pieces fit together](#3-how-the-pieces-fit-together)
4. [A booking from start to finish](#4-a-booking-from-start-to-finish)
5. [Feature area 1 — The service catalog](#5-feature-area-1--the-service-catalog)
6. [Feature area 2 — Availability and the slot engine](#6-feature-area-2--availability-and-the-slot-engine)
7. [Feature area 3 — Booking](#7-feature-area-3--booking)
8. [Feature area 4 — Managing a booking](#8-feature-area-4--managing-a-booking)
9. [Feature area 5 — The admin console](#9-feature-area-5--the-admin-console)
10. [Feature area 6 — Notifications](#10-feature-area-6--notifications)
11. [Feature area 7 — Accounts, roles and permissions](#11-feature-area-7--accounts-roles-and-permissions)
12. [Feature area 8 — Analytics and reporting](#12-feature-area-8--analytics-and-reporting)
13. [Feature area 9 — Background jobs](#13-feature-area-9--background-jobs)
14. [The five hard problems and how they were solved](#14-the-five-hard-problems-and-how-they-were-solved)
15. [What the database stores](#15-what-the-database-stores)
16. [Security and safety](#16-security-and-safety)
17. [Reliability and operations](#17-reliability-and-operations)
18. [The technology, and why each piece](#18-the-technology-and-why-each-piece)
19. [Testing](#19-testing)
20. [What was deliberately not built](#20-what-was-deliberately-not-built)
21. [Glossary](#21-glossary)

---

## 1. What this project is

Meridian is an **appointment booking system** — the kind of software a clinic, salon, law
firm or consultancy would use so that customers can book their own appointments online
instead of calling a receptionist.

It has two halves:

- **A public website**, where a customer browses services, sees which times are free,
  and books — without needing an account.
- **An admin console**, where staff see their calendar, manage appointments, set their
  working hours, block out holidays and read reports.

But the screens are the easy part. The genuinely difficult part — and what this project
is really about — is the **booking engine**: the code that answers the question *"which
times are actually free?"* and then makes sure **two people can never end up with the
same slot**.

That sounds simple. It is not. Sections 6 and 14 explain why.

---

## 2. Who uses it

**The customer.** Someone who wants an appointment. They should be able to book in under
a minute, with no signup. They can later reschedule or cancel through a private link sent
to them.

**The provider.** The doctor, stylist, lawyer or consultant who actually delivers the
service. They publish their working hours, take time off, and see only their own
calendar — never anyone else's.

**The admin.** The person running the business. They see everything: every appointment,
every provider's calendar, revenue and cancellation reports, and the audit trail of who
changed what.

The system knows the difference between these three and enforces it on the server. A
provider who tries to look at another provider's appointments gets refused by the API, not
just hidden from in the user interface.

---

## 3. How the pieces fit together

The project is one code repository containing three parts:

```
apps/api          The backend  — Express + Prisma + PostgreSQL
apps/web          The frontend — Next.js + React + Tailwind
packages/shared   The contract — shared rules both sides agree on
```

**`apps/api` (the backend)** holds all the intelligence. It decides what is available,
whether a booking is allowed, and what the rules are. It talks to PostgreSQL.

**`apps/web` (the frontend)** is the part people see. Crucially, **it never calculates
anything about availability**. It asks the backend "which times are free on the 20th?" and
draws whatever comes back. If it tried to work that out itself, the browser could offer a
time that the backend would then refuse — which looks broken to the customer.

**`packages/shared` (the contract)** is a small library both halves import. It holds the
data validation rules, the list of appointment statuses, and the list of error codes. The
point is that these are written **once**. If the backend changes what a valid phone number
looks like, the frontend picks up the same rule automatically — the two can't drift apart.

### Why one backend instead of microservices

This is a **modular monolith**: a single backend process, but internally split into clean
modules (auth, slots, appointments, analytics, availability) that don't reach into each
other's internals.

The reason is practical. Creating a booking writes three things at once — the appointment,
its history entry, and a pending notification — and all three must either happen together
or not at all. In one database, that's a single transaction and it's free. Split across
three services, it becomes a distributed transaction problem, which is genuinely hard. The
module boundaries are already clean, so if any part ever needs to be pulled out, it can be.

---

## 4. A booking from start to finish

Here is the whole flow in plain words, so the rest of the report has something to hang on.

**1. The customer opens the site.** They see a list of services — "General Consultation,
30 minutes, ₹800". This list comes from the backend.

**2. They pick a service.** The page now shows a month calendar. Behind the scenes, the
browser asks the backend: *"for this service, which dates between the 1st and the 30th have
at least one free time?"* Dates with nothing free are greyed out. This alone prevents the
most annoying experience in booking software — clicking through empty days.

**3. They pick a date.** The browser asks: *"which exact times are free on the 20th, shown
in my timezone?"* The backend runs the slot engine and returns a list like 09:00, 09:15,
11:00, 11:15… The browser just draws the buttons.

**4. They pick a time and fill in their details.** Name, email, phone, optional notes, plus
any custom questions the business attached to that service. While they type, the slot is
*softly held* for a few minutes so it doesn't disappear under them (see [section 14.1](#141-two-people-booking-the-same-slot)).

**5. They submit.** Now the serious part runs, described fully in [section 7](#7-feature-area-3--booking):
the backend re-checks every rule, takes a lock, counts the daily limits, and inserts the
appointment. PostgreSQL itself has the final say on whether the slot was free.

**6. They get a confirmation** with a reference code like `APT-2026-000123` and a private
management link.

**7. Behind the scenes**, a notification was queued inside the same database transaction
as the booking, and a background worker picks it up and sends the email a moment later.

**8. Later**, the customer can open their private link to view, reschedule or cancel — and
the staff see the appointment on their calendar the moment it exists.

---

## 5. Feature area 1 — The service catalog

A **service** is a thing the business offers. In the system, a service is far more than a
name and a price — it carries the rules that decide how it can be booked:

| Setting | What it means in plain words |
|---|---|
| Name, description, category | What it is |
| Duration | How long the appointment actually lasts (say 30 minutes) |
| Buffer before / after | Prep and cleanup time around it (say 10 minutes each side) |
| Slot interval | How often a start time is offered — every 15 minutes, say |
| Price and currency | What it costs |
| Payment mode | Free / pay now / pay later |
| Location type | In person, online, or phone |
| Minimum notice | You cannot book less than 2 hours ahead |
| Maximum advance | You cannot book more than 30 days ahead |
| Max per day | At most 8 of these per day |
| Max per customer per day | One per customer per day, so nobody hogs the calendar |
| Cancellation policy | Which deadline rules apply |

Two of these deserve a note.

**Slot interval is separate from duration.** A 30-minute service with a 15-minute interval
can start at 09:00, 09:15, 09:30 and so on. Most simple systems assume slots are duration
sized and butt up against each other — which is wrong for real businesses.

**Buffers are separate from duration.** The customer is told "30 minutes" and is charged
for 30 minutes, but the provider's calendar actually loses 50 minutes. Keeping those
separate is what lets the system show honest times to the customer while protecting the
provider's real schedule.

### Services and providers

A service can be offered by several providers, and one provider can offer several services.
A given pairing can even override the duration or price — "Dr Shah's consultation runs 45
minutes, not 30."

### Custom booking questions

Each service can have its own intake questions — free text, a paragraph, a dropdown,
multiple choice, a checkbox, a phone number, an email, a number. These appear in the
booking form and their answers are stored with the appointment.

One subtle touch: the **wording of the question is copied onto the answer**. If the business
later rewrites the question, the old answer still shows the question as it was actually
asked. Otherwise a stored answer of "Yes" could silently end up attached to a completely
different question.

---

## 6. Feature area 2 — Availability and the slot engine

This is the core of the project.

### How a provider describes when they work

**Weekly working hours.** "Monday 09:00–13:00 and 14:00–18:00." Notice this is two separate
windows — that's how a lunch break is expressed. No special "break" concept is needed;
a day is simply a list of windows.

**Date-specific overrides.** "On the 20th, I work 11:00–15:00 instead." An override
**replaces** that day's normal hours; it doesn't add to them. That matters: if it merged,
a provider who said "on the 20th I only work the afternoon" would still be exposed all
morning. There's also an "unavailable" override type for a plain day off.

**Time off.** Vacation, sick leave, personal time, or an ad-hoc block. Unlike working
hours, this is stored as an absolute period of time, because it can span several days and
must not shift if the provider changes their timezone setting.

**Holidays.** Business-wide closures that apply to every provider at once.

### What the slot engine does

The engine's job: given a service, a provider, and a date, produce the exact list of start
times a customer may choose.

It is written as a **pure function** — it has no database connection, no web server, and no
clock of its own. Everything it needs is handed to it, and it returns plain data. That's
deliberate: this is the one place in the system where being wrong is both expensive and
silent, so it has to be testable in isolation, in milliseconds, without starting anything
up. That's exactly what the 75 tests do.

### The eight things it takes into account

**1. Working hours.** Get the day's windows — from the override if there is one, otherwise
from the weekly rules.

**2. Time off.** Cut time off out of those windows. If nothing is left, the day is done.

**3. Holidays.** If the date is a business holiday, skip it entirely.

**4. The booking horizon.** If the date is further ahead than the service allows (say 30
days), skip it.

**5. The grid.** Walk across the day in steps of the slot interval — 00:00, 00:15, 00:30 …
anchored to the *provider's* local midnight, because it's their calendar the customer is
reading.

**6. Minimum notice.** Throw away any start time that's sooner than the service's notice
period allows, measured against the clock that was passed in.

**7. Bookability.** The appointment body — start to start + duration — must fit **entirely
inside** one published working window. A 30-minute service can't start at 17:45 if the
provider closes at 18:00.

**8. Occupancy.** The appointment plus its buffers on both sides must not touch any
existing booking. Existing bookings are compared using *their* buffered footprints too.

Whatever survives all eight checks is a bookable slot.

### The buffer rule that most systems get wrong

Steps 7 and 8 use **different** intervals, and this is the single most important detail in
the engine:

- **Bookability** checks `[start, start + duration]` against working hours.
- **Occupancy** checks `[start − bufferBefore, start + duration + bufferAfter]` against
  other bookings.

The consequence: **buffers are allowed to spill outside opening hours.** A 10-minute prep
buffer before a 09:00 appointment does not require the clinic to open at 08:50 — the
provider just arrives a bit early. But **buffers stack between two neighbouring
appointments**: the gap needed between them is the first one's trailing buffer *plus* the
second one's leading buffer, because each appointment reserves its own footprint and the
two footprints may not overlap.

Conflating those two rules is the classic bug in booking software. It produces one of two
failures: either you lose the first and last slot of every day for no reason, or you
double-book two appointments whose buffers overlap.

**The pinned example** (this exact case is a test, so it can never silently change):

> Provider works Monday 09:00–17:00. Service is 30 minutes with 10-minute buffers on both
> sides. There is already a booking at 10:00–10:30. Slots are offered every 15 minutes.
>
> Answer: **exactly 24 slots** — 09:00, then 11:00 through 16:30.

Worth walking through: 09:00 works (its 08:50 buffer spilling before opening is fine).
09:15 doesn't, because its footprint would run to 09:55 and the existing booking's
footprint starts at 09:50. Everything up to 11:00 is blocked by the existing booking plus
its trailing buffer plus the new one's leading buffer. And 16:45 fails bookability, because
a 30-minute appointment starting then would end at 17:15, past closing.

### "Any provider"

If the customer doesn't care who they see, the engine generates slots for **every** eligible
provider and merges them. When two providers are both free at 11:00, it offers the one with
the **lighter load**, using the provider ID as a tiebreaker so the answer is deterministic —
a customer refreshing the page must not see the assigned practitioner flicker between two
names.

### Two questions the API can answer

- **"Which dates have anything free?"** — drives the month calendar, so dead days are
  greyed out before the customer clicks them.
- **"Which times are free on this date?"** — drives the list of time buttons.

---

## 7. Feature area 3 — Booking

When the customer hits Confirm, this is what happens, and every step is there for a reason.

**Before the transaction**

1. Load the service. Reject it if it's missing, deleted or switched off.
2. Reject a start time in the past.
3. Find or create the customer record, keyed on **email address**. A repeat guest reuses
   their record and accumulates a history, rather than creating a pile of duplicates.
4. **Re-run the slot engine** for that exact time. This is the step that turns predictable
   failures into precise, explainable errors: "the clinic is closed then", "that's too soon
   to book", "the provider is on leave" — instead of a vague conflict message. If the
   customer chose "any provider", this is also where a concrete provider gets picked.
5. Check the provider is still active.
6. Decide the starting status: a pay-at-booking service starts as **PENDING** (awaiting
   payment) and holds its slot for 15 minutes; everything else is **CONFIRMED** immediately.

**Inside the transaction**

7. **Take two locks** — one on this provider + this exact slot, one on this provider + this
   day. Locks are always taken in a fixed sorted order, which prevents two requests from
   deadlocking by grabbing the same pair in opposite orders. The purpose of the locks is to
   line up the handful of requests contending for the same slot so the next step can be
   trusted.
8. **Re-count the daily limits** now that the lock is held — the provider's max-per-day and
   the customer's max-per-day. The count taken in step 4 is already out of date by
   definition; this is the count that decides. A limit like "at most 8 per day" simply
   cannot be expressed as a database constraint, which is exactly why this lock exists.
9. **Insert the appointment**, with a generated reference code and all the snapshot fields
   (see below). **This is the moment of truth** — see [section 14.1](#141-two-people-booking-the-same-slot).
10. Write the history entry.
11. Store the answers to any custom questions, with the question wording snapshotted.
12. Write a **notification row into the outbox table** — inside the same transaction.

If anything fails, the whole thing rolls back and nothing happened. If PostgreSQL rejects
the insert because someone else got there microseconds earlier, that's caught and turned
into a clean `409 SLOT_UNAVAILABLE` — "sorry, that time just went, please pick another."

### Snapshots — why the appointment copies everything

The appointment row doesn't just point at the service; it **copies** the service name,
duration, buffers, price, currency, payment mode, provider name and location onto itself.

That looks like duplication, but it's the correct choice. If the business raises its prices
next month, last month's appointments must still show what the customer actually paid. If a
service gets renamed, old records must still say what was actually booked. A record of
something that happened should not silently change when unrelated configuration changes.

### The management token

Every booking generates a random token. The customer gets it in their confirmation link;
the database stores only a **SHA-256 hash of it**. This means:

- A customer manages their booking through `/manage/<token>` — **never** through the
  appointment ID. If the ID were the key, anyone could change a number in the URL and read
  other people's bookings.
- If the database itself leaked, the stored hashes wouldn't let anyone manage anything.
- The token expires 30 days after the appointment ends.

---

## 8. Feature area 4 — Managing a booking

### Cancelling

Anyone holding the manage link (or signed in as the owning customer) can cancel. The rules:

- The appointment must currently be confirmed or pending — you can't cancel something
  already completed or already cancelled.
- The service's **cancellation policy** decides whether cancelling is allowed at all and
  how late it's allowed. A typical policy: "up to 24 hours before."
- A reason can be recorded — schedule conflict, no longer needed, booked by mistake, or
  something else.
- **Staff bypass the deadline.** A receptionist cancelling on the phone shouldn't be
  blocked by the customer-facing cutoff.

The appointment row is **not deleted**. Its status changes to CANCELLED, which immediately
removes it from the "occupying" list, so the slot becomes bookable again the instant the
status changes — while the record itself survives for history and reporting.

Important: the UI shows the deadline for honesty, but the **server enforces it**. A
customer who works out how to call the API directly after the cutoff still gets refused.

### Rescheduling

More interesting than it looks. Rescheduling does **not** edit the appointment in place.
Instead:

1. Check the policy: is rescheduling allowed, is it before the deadline, and has this
   booking already been moved the maximum number of times?
2. Take locks on the **old** slot, the **new** slot, and the day.
3. **Retire the old appointment to RESCHEDULED first.**
4. **Then create a new appointment** at the new time, carrying over all the snapshots, with
   a pointer back to its predecessor, the same "root" ID so the whole chain can be traced,
   and a move counter incremented by one.
5. Write two history entries — one on each row — and queue a notification.

Both writes share one transaction, so a failed move leaves the original booking exactly as
it was, rather than cancelling it and stranding the customer with nothing.

**Why the ordering matters so much.** If the new row were inserted first, it would collide
with the old row's still-active reserved time — and the old row is *the same appointment*.
The result: the single commonest reschedule, "move it fifteen minutes", would fail with a
message telling the customer their own appointment is in the way. Retiring first avoids it
completely.

The customer gets a **fresh management token** for the new appointment; the old one stops
working.

### Marking the outcome

Staff can mark a past appointment **Completed** or **No-show**. Both are terminal — nothing
moves out of them. This is what feeds the no-show rate on the dashboard.

### The status rules

Every appointment is in exactly one of six states, and moves between them are governed by a
single explicit table of legal transitions that also records **who** may make each move:

```
PENDING   → CONFIRMED  (admin, provider or the system)
PENDING   → CANCELLED  (anyone)
CONFIRMED → CANCELLED  (anyone)
CONFIRMED → RESCHEDULED(anyone)
CONFIRMED → COMPLETED  (staff or the system)
CONFIRMED → NO_SHOW    (staff only)
```

CANCELLED, COMPLETED, NO_SHOW and RESCHEDULED are **terminal** — nothing leaves them. No
piece of code assigns a status directly; every change is routed through this table. That's
what stops a sequence of ordinary-looking bug fixes from quietly inventing an illegal
transition like "cancelled → confirmed".

---

## 9. Feature area 5 — The admin console

A sidebar layout on desktop that becomes a slide-over menu on a phone. The navigation only
renders after the session is confirmed, so a signed-out visitor never sees the console
frame flash before being told to sign in.

### Dashboard

Headline numbers for a chosen period: today's bookings, total bookings, confirmed,
completed, cancelled, no-shows, cancellation rate as a percentage, revenue from completed
appointments, and the average bookings per day. Plus two charts — bookings over time as an
area chart, and a status breakdown as a pie chart — a list of the most-booked services, and
today's upcoming appointments.

### Calendar

Day, week and month views of the schedule, with appointment details on click.

It's deliberately a **list of appointments per day column**, not a grid of absolutely
positioned blocks. At a clinic's density, a time-ordered list is easier to scan, far easier
to make accessible to screen readers, and it collapses to a single column on a phone
without needing a separate mobile design.

### Appointments

A full table with:

- **Search** by reference code, service name, customer name or customer email
- **Filters** by status, service and date range
- **Pagination**
- **CSV export** of the current view, for accounts or reporting
- Row actions: cancel, or mark completed / no-show

Scoping is enforced by the API: an admin sees every appointment, a provider sees only their
own, a customer sees only theirs. Asking for someone else's data doesn't work regardless of
what the request says.

### Availability

The working-hours editor. Pick a provider (admins can pick anyone; providers only
themselves), then for each weekday add one or more time windows. There's a copy function so
"same as Monday" doesn't have to be typed out five times. Saving replaces that provider's
whole weekly schedule in one transaction, so a half-saved week can't exist.

The same screen manages **time off** — add a vacation or a blocked afternoon, see upcoming
entries, delete one.

### Services

An overview of every service and every provider, showing exactly the rules the slot engine
uses — duration, buffers, notice, horizon, caps, cancellation policy, and who delivers what.
It doubles as a diagnostic screen: if someone asks "why does this service only offer four
times a day?", the answer is visible here.

This screen is currently **read-only** — services and providers are managed through the
database and seed script. It's the most obvious gap in the project and is called out
honestly rather than hidden.

---

## 10. Feature area 6 — Notifications

Emails go out on booking, confirmation, cancellation, rescheduling, and as reminders.

The interesting part is **how** they're sent, because the obvious approach is subtly broken.

**The obvious approach:** save the booking, then send the email. Two ways this goes wrong:

- The save succeeds, then the server crashes before the email sends → the customer has an
  appointment and no idea it exists.
- The email sends, then the transaction fails and rolls back → the customer has a
  confirmation for an appointment that doesn't exist.

**What this project does — the transactional outbox pattern:**

Instead of sending during the request, the booking transaction writes a row into an
**outbox table**, right alongside the appointment itself. Because it's the same
transaction, the two either both commit or both roll back. There is no window where one
exists without the other.

A background worker then drains that table: it claims a batch of rows using `FOR UPDATE
SKIP LOCKED` (so several API instances can run at once and each picks up a different
batch instead of fighting over the same rows), renders the email, sends it, and marks the
row processed. If sending fails it retries with increasing delays, and after 5 failed
attempts the row is marked **dead-lettered** rather than retried forever or silently lost.

Reminders need no separate machinery — a reminder is just an outbox row scheduled for a
future time.

**Email delivery sits behind an interface.** In development it prints to the console or
writes `.eml` files to a folder so you can actually read what was sent, including the
management links, without configuring a mailbox. Swapping in a real provider like Resend,
SES or SendGrid is one new file and one line — no booking code changes at all.

Every send attempt is also written to a notification log, so there's a record of what went
to whom and whether it worked.

---

## 11. Feature area 7 — Accounts, roles and permissions

### Signing in

Email and password. Passwords are hashed with bcrypt at 12 rounds — they're never stored or
recoverable in readable form.

One nice detail: if the email doesn't exist, the system still compares the password against
a dummy hash before failing. Without that, an unknown email would fail *noticeably faster*
than a wrong password, which quietly tells an attacker which email addresses are registered.

### Staying signed in

Two tokens, both in **httpOnly cookies** — meaning JavaScript on the page cannot read them,
so a cross-site scripting bug can't steal the session.

- A short-lived **access token** (a JWT) proving who you are on each request.
- A longer-lived **refresh token** used to get a new access token.

Refresh tokens get the careful treatment:

- They're random strings, not JWTs, and only their **SHA-256 hash** is stored. A database
  leak hands out no sessions.
- They **rotate** — every use issues a new one and retires the old.
- They belong to a **family**. If an already-used token is presented again, that's treated
  as theft (someone copied it), and the **entire family is revoked**, logging the attacker
  and the real user out together. That's the correct trade: better a re-login than a
  silently hijacked account.

### Roles and permissions

There are three roles — Admin, Provider, Customer — but routes are **never** guarded by
role name. They're guarded by a **capability**, like `appointments.cancel` or
`availability.manage`. Roles expand into sets of around 30 such capabilities, stored in the
database.

Why that matters: changing who is allowed to do what becomes a **data change, not a code
change**. "Let providers see the audit log" is a row, not a deployment.

There's a second, separate layer. A capability answers *"may this kind of user do this at
all?"* It does **not** answer *"may they do it to **this particular record**?"* A provider
holding `appointments.cancel` may still only cancel their own appointments, and that
ownership check lives in the service layer. Both checks have to pass.

### Guests

A customer record can exist with no login at all. Guest bookings are keyed on email and
managed through the token link. This is a first-class path, not an afterthought — most real
bookings never create an account.

---

## 12. Feature area 8 — Analytics and reporting

Two endpoints feed the dashboard:

**Summary** — for a chosen window (default 30 days): total bookings, a breakdown by status,
the cancellation rate, revenue from completed appointments, the average per day, today's
count, and the top five services by volume.

**Time series** — day-by-day buckets of bookings, cancellations and revenue, which becomes
the dashboard's area chart.

There is also an **audit log**: who did what, to which record, from which IP and browser.
Admins can page through it. It's written explicitly by the services that change state, not
inferred after the fact.

---

## 13. Feature area 9 — Background jobs

Three jobs run on a timer inside the API process:

**1. Drain the outbox.** Send the queued notifications (section 10).

**2. Release expired holds.** A pay-at-booking appointment sits at PENDING and holds its
slot for 15 minutes. If payment never arrives, this job cancels it — with the system itself
recorded as the actor — and the slot returns to the pool. Without this, abandoned checkouts
would squat slots forever and keep counting against the customer's daily limit. It uses a
small grace period so it doesn't race a confirmation that's in flight at the exact moment
the hold lapses, and it re-checks the status inside the transaction in case a payment
webhook confirmed it a moment ago.

**3. Auto-complete past appointments.** A confirmed appointment that finished over an hour
ago is marked completed automatically, so the dashboard reflects reality without a
receptionist ticking every row by hand.

These run **in-process** rather than as a separate queue service. At this scale a queue
would mean a second thing to deploy, a second thing to break, and a hard Redis dependency,
in exchange for very little — the outbox table already provides durability and
at-least-once delivery. A failing tick is logged and never takes the API down with it.

---

## 14. The five hard problems and how they were solved

This section is the heart of the project. Each problem is stated plainly, followed by the
obvious approach, why it fails, and what was actually done.

### 14.1 Two people booking the same slot

**The problem.** Two customers click "confirm" on the 11:00 slot at the same instant.

**The obvious approach.** Before inserting, check whether anything overlaps. If nothing
does, insert.

**Why it fails.** Between the check and the insert, the *other* request can check and
insert too. Both see an empty slot, both insert, and now the provider has two people at
11:00. This isn't a rare edge case — it's guaranteed to happen eventually, and it's
guaranteed to happen precisely when the business is busiest. A read-then-write check is a
race by construction, and no amount of careful coding removes it.

**What this project does — three layers, of which only the last is a guarantee:**

**Layer 1 — the Redis hold (comfort).** When a customer picks a time, it's held for a few
minutes so it doesn't vanish while they fill in the form. This is **purely cosmetic**: the
booking code never looks at it. If Redis is down, slow, or entirely absent, bookings are
still completely correct. This line is held on purpose — the moment the write path started
trusting a hold, Redis availability would become a *correctness* dependency, and an outage
would start producing double bookings. The test suite deliberately deletes the Redis
configuration to prove the system is correct without it.

**Layer 2 — advisory locks (ordering).** Before inserting, the transaction takes a lock on
(this provider, this slot) and (this provider, this day). This lines up the few requests
contending for the same thing so they proceed one at a time. It exists mainly so that the
**daily limits can be counted reliably** — "at most 8 per day" cannot be expressed as a
database constraint, so it needs a lock to be counted under.

**Layer 3 — the database exclusion constraint (the guarantee).** PostgreSQL has a feature
that says: *"for any two rows with the same provider, their time ranges may not overlap."*
It's enforced by the storage engine itself.

This is the real answer, and the property that makes it the real answer is: **it does not
care what wrote the row.** Not the API, not a buggy future refactor, not a data-migration
script, not someone typing SQL into a terminal at 2am. An overlapping row is not unlikely —
it is *impossible*. When a request loses the race, PostgreSQL rejects it with error code
`23P01`, which the API translates into a friendly `409 SLOT_UNAVAILABLE`.

**Verified:** six simultaneous requests for the same slot produce **one success and five
conflicts**. Every time.

Three supporting details worth knowing:

- The reserved range uses **half-open bounds** — an appointment ending at 14:30 and one
  starting at 14:30 touch but do not overlap, so back-to-back bookings with no buffer are
  legal. Using closed bounds would wrongly reject them.
- The reserved (buffered) times are computed by a **database trigger**, not by application
  code. If the app supplied them, a bug could submit a range narrower than the buffers imply
  and slip straight past the constraint. Deriving them in the database closes that door.
- The constraint only applies to statuses that actually occupy the calendar. A cancelled
  appointment keeps its row — history is never destroyed — but stops blocking its slot the
  instant its status changes. That list of statuses exists in both SQL and TypeScript, and a
  test asserts the two match, because drift would either offer slots the database then
  rejects, or hide bookable ones forever.

One consequence worth stating: `prisma db push` is **banned** in this project, because it
would silently drop the constraint with no visible error. The README says so in bold, and a
test asserts the constraint still exists after a clean migration.

### 14.2 Timezones and daylight saving

**The problem.** A provider in London says "I work 09:00 to 17:00 on Mondays." A customer in
Mumbai wants to see times in their own clock. And twice a year, the clocks change.

**The obvious approach.** Convert the working hours to UTC once and store that.

**Why it fails.** "09:00 London" is 08:00 UTC in winter and 07:00 UTC in summer. Store it
once as UTC and half the year the provider's published hours are silently an hour wrong —
which nobody notices until a customer shows up at the wrong time.

**What this project does.** Working hours are stored as **local wall-clock minutes plus an
IANA timezone name** — "540 minutes after midnight, Europe/London" — and converted to a real
instant **per calendar date**. Appointments themselves are stored as UTC instants, because
an appointment *is* a moment in time.

The two daylight-saving anomalies are handled explicitly rather than left to library
defaults:

- **Spring forward** — one hour simply doesn't exist. A working-hours edge landing in the
  gap is clamped forward; a candidate start time in the gap is dropped, because you cannot
  offer an appointment at a time that never happens.
- **Fall back** — one hour happens *twice*, so a wall-clock time like 01:30 is ambiguous.
  The system always picks the **earlier** occurrence, everywhere, without exception. The
  consistency is the point: a slot shown to a customer and the booking written a minute
  later must agree on which 01:30 they meant.

The slot grid also steps in **wall-clock minutes**, not by adding fixed amounts of time. So
across a transition the customer still sees 09:00, 09:15, 09:30 — the underlying UTC offset
moves, but the human-facing times stay aligned, which is what the human expects.

Tested across four timezones, in both hemispheres (the southern hemisphere matters —
daylight saving runs the opposite way round, so a hardcoded assumption breaks there). The
demo seed data deliberately places one provider in New York so the DST paths are exercised
by the demo, not only by the test suite.

### 14.3 Buffers

Covered in [section 6](#the-buffer-rule-that-most-systems-get-wrong). In short: the
appointment must fit inside working hours, but the appointment *plus its buffers* must
clear other bookings. Two different intervals, two different rules. Conflating them either
loses the first and last slot of every day, or double-books appointments whose buffers
collide.

### 14.4 "Move it fifteen minutes"

**The problem.** A customer wants to shift their 11:00 appointment to 11:15.

**The obvious approach.** Create the new appointment, then cancel the old one.

**Why it fails.** The new 11:15 appointment overlaps the old 11:00 one, which is still
active for a few more milliseconds — so the database rejects it, and the customer is told
the slot is unavailable. Their own appointment blocked them. And because small moves are by
far the most common kind of reschedule, this bug fires on the *typical* case, not an edge
case.

**What this project does.** Retire the old appointment to RESCHEDULED **first**, then insert
the new one, both inside one transaction. The old one stops occupying the calendar the
instant its status changes, so the new one slots in cleanly. And because it's one
transaction, a failure leaves the original booking untouched rather than cancelling it and
leaving the customer with nothing.

### 14.5 Making time-dependent rules testable

**The problem.** Minimum notice, cancellation deadlines and DST behaviour all depend on
"now". Code that calls the system clock directly can only be tested by waiting, or by
mocking the clock globally and hoping nothing else reads it.

**What this project does.** Every time-dependent rule takes `now` as a **parameter**, and an
ESLint rule **forbids** reading the system clock anywhere except one small file. A test can
therefore say "pretend it is 02:30 on the night the clocks go back in Sydney" and get a
deterministic answer in a millisecond.

This is why the 75 tests can cover DST transitions, notice windows and deadlines at all —
without it, those rules would be effectively untestable, and untested rules about time are
exactly the ones that break twice a year.

---

## 15. What the database stores

Roughly 20 tables. In plain terms:

**Configuration**
- *Business settings* — one row: business name, timezone, currency, and the defaults new
  services inherit.

**People and access**
- *Users* — anyone who can sign in, with their role.
- *Permissions* and *role permissions* — the capability list and which roles get which.
- *Refresh tokens* — hashed session tokens with their family and expiry.
- *Providers* — the staff who deliver services, with their own timezone.
- *Customers* — may or may not be linked to a user account (guests aren't).

**Catalog**
- *Services* — with all their booking rules.
- *Service providers* — which provider offers which service, with optional overrides.
- *Cancellation policies* — deadlines and limits, reusable across services.
- *Booking questions* — custom intake questions per service.

**Availability**
- *Availability rules* — recurring weekly windows in local minutes.
- *Availability overrides* + *override windows* — date-specific replacements.
- *Time off* — absolute periods a provider is unavailable.
- *Holidays* — business-wide closures.

**Bookings**
- *Appointments* — the central table. Holds the customer-facing times, the buffered times
  actually reserved, all the snapshot fields, the reschedule chain, the hashed management
  token, and cancellation details.
- *Appointment history* — append-only log of every change.
- *Booking answers* — answers to custom questions, with the wording snapshotted.
- *Idempotency keys* — modelled so a retried booking request can return the original
  response instead of creating a second booking. **Not yet wired into the route** — honest
  disclosure, it's in the schema and on the roadmap.

**Notifications and audit**
- *Outbox events* — queued side effects with attempt counts and dead-letter marking.
- *Notification templates* and *notification logs* — what to send, and what was sent.
- *Audit logs* — who did what.

Three conventions run through all of it:

1. **Nothing with history is ever deleted.** Providers and services are deactivated. A
   cancelled appointment keeps its row.
2. **History is append-only, enforced by the database.** A trigger rejects UPDATE and DELETE
   on the history table outright. The whole point of an audit trail is that it cannot be
   quietly rewritten, so it doesn't rely on nobody writing the wrong query.
3. **Snapshots over references** for anything that must reflect the past accurately.

---

## 16. Security and safety

| Concern | What's done |
|---|---|
| Password storage | bcrypt, 12 rounds |
| Account enumeration | Unknown emails still get a dummy hash comparison, so timing reveals nothing |
| Session theft via XSS | Tokens live in httpOnly cookies; page JavaScript cannot read them |
| Stolen refresh token | Tokens rotate; reuse revokes the entire token family |
| Database leak | Refresh tokens and management tokens are stored only as hashes |
| Guessing other people's bookings | Guest access is by random token, never by appointment ID |
| Brute-forcing passwords | Login limited to 10 attempts per 15 minutes, keyed on IP **and** the email being tried, so a spray can't be spread thinly across many accounts from one host |
| Booking spam | Tighter, separate limit on the unauthenticated booking endpoint |
| Rate limiter evasion | Uses proper IPv6 prefix handling — otherwise an attacker could walk their own address range for a fresh budget every request |
| Malformed or hostile input | Every body, query and URL parameter validated with Zod |
| Oversized payloads | 256 KB body cap — a booking payload is tiny, so this removes a trivially cheap denial of service |
| Common web attacks | Helmet security headers, strict CORS allow-list, `x-powered-by` disabled |
| Privilege escalation | Capability checks **plus** a separate ownership check in the service layer |
| Leaking internals in errors | Customer-facing messages are deliberately free of internal detail |

On error handling generally: the API returns one consistent envelope, always. Success is
`{ success: true, data, message }`; failure is `{ success: false, error: { code, message } }`.
Clients switch on the **code**, never the human message — the message is free to be reworded,
the code is a contract. There are around 50 codes, each mapping to exactly one HTTP status:
400 validation · 401 authentication · 403 permission · 404 missing · 409 conflict ·
422 business rule · 429 rate limit · 500 server.

That 409-versus-422 distinction is a real one: 409 means *someone else got there first*
(retry might work), 422 means *this breaks a rule* (retrying won't help).

---

## 17. Reliability and operations

**Two health endpoints, and the difference is deliberate.**
`/health` says "is this process alive" and checks **nothing else** — so a brief database
blip doesn't cause the orchestrator to kill an otherwise healthy process. `/ready` says
"should this instance receive traffic" and checks the database. It *reports* Redis status
but does **not** fail on it, because nothing depends on Redis for correctness.

**Graceful shutdown.** On a shutdown signal, the server stops accepting new requests, lets
in-flight ones finish, closes the database and Redis connections, and exits — with a
10-second backstop that forces an exit if that stalls. This matters more than usual here: a
booking transaction interrupted mid-commit is exactly the scenario that leaves a customer
with a confirmation and no appointment.

**Structured logging.** Every request gets an ID, which is echoed back in the response
header and attached to every log line for that request. When a customer reports a problem
and quotes the ID, the whole request is one search away.

**Runs on multiple instances safely.** The outbox worker claims rows with `SKIP LOCKED` and
the booking guarantees live in the database, so nothing about correctness depends on there
being only one API process.

**Rate limiting is deliberately in-process, not in Redis.** A shared store would only matter
across multiple instances, and buying that accuracy would mean the API failing to start
whenever Redis is briefly unreachable — trading a real availability risk for a hypothetical
accuracy gain. The booking guarantees live in PostgreSQL either way.

**Deployment.** A Render blueprint file deploys the database, API and web client together on
free tiers. Migrations run on deploy; `prisma db push` is banned.

---

## 18. The technology, and why each piece

| Choice | Why |
|---|---|
| **TypeScript everywhere** | One language across backend, frontend and shared contract; types catch whole classes of mistakes before running |
| **PostgreSQL** | The exclusion constraint that makes double booking impossible is a PostgreSQL feature. This is the single biggest reason for the choice |
| **Prisma** | Type-safe database access; the schema is the single source of truth for the data model |
| **`@prisma/adapter-pg`** | Chosen specifically so PostgreSQL's error code survives on the thrown error. Without it, "slot taken" is indistinguishable from a generic failure |
| **Express 5** | Small, well understood, no ceremony; the interesting logic lives in the domain layer, not the framework |
| **Next.js 16 + React 19** | Server rendering for the public pages (good for speed and search engines), client interactivity for the booking flow and console |
| **Tailwind CSS 4** | Consistent styling without a parallel stylesheet codebase |
| **Recharts** | Dashboard charts |
| **Zod** | One validation library used by both halves via the shared package, so the rules can't drift |
| **Redis (optional)** | Slot holds only. Explicitly never a correctness dependency |
| **Vitest** | Fast test runner; the pure domain layer means the suite finishes in about a second |
| **npm workspaces** | One repo, three packages, shared dependencies, one install |

---

## 19. Testing

**75 tests across 3 files, all passing, in about 1.2 seconds.**

- **Interval algebra** (26 tests) — the maths underneath everything: do two periods
  overlap, does one fit inside another, subtract one set of periods from another, merge
  adjacent ones. Boundary cases are the whole point here.
- **Timezones** (21 tests) — converting local times to instants, both DST anomalies, four
  timezones, both hemispheres.
- **The slot engine** (28 tests) — the pinned 24-slot acceptance case, buffer stacking,
  bookability versus occupancy, lunch breaks, overrides replacing a day, time off,
  holidays, minimum notice, the booking horizon, daily caps, and merging multiple providers.

Two things about the suite worth mentioning:

The tests run against the **pure domain layer**, so there's no database to set up and no
server to start. That's what makes covering DST transitions in four timezones practical
rather than theoretical.

The test setup **deliberately deletes the Redis configuration**. The suite must pass with
Redis entirely absent. That's not a convenience — it's the standing proof that Redis is an
accelerator and never a correctness dependency, enforced automatically on every run.

Honest gap: integration tests that run against a live database are thinner than the domain
unit tests.

---

## 20. What was deliberately not built

These were cut consciously to keep the first version focused on getting the booking loop
genuinely right, rather than shipping a wide surface of half-working features.

**Payments.** The groundwork is there — services carry a payment mode, and the
PENDING → CONFIRMED path with expiring holds already works end to end. A payment provider
slots in behind it without reshaping the domain.

**External calendar sync** (Google, Outlook). Purely additive: one more source of busy time
feeding the engine, which already merges several sources.

**Multi-tenancy.** The business settings table is configuration for one business, not
tenancy. Supporting several businesses in one deployment is a real piece of work and was
scoped out.

**Admin CRUD for services and providers.** Read-only screens today; managed through the
database and seed script.

**Idempotency keys on the booking endpoint.** The table is modelled and the header is
already accepted by CORS, but the middleware isn't wired up yet. It would make a retried
booking request return the original response instead of creating a second booking.

---

## 21. Glossary

**Slot** — a start time a customer is allowed to pick.

**Buffer** — prep or cleanup time reserved around an appointment but not shown to the
customer as part of its length.

**Bookability** — whether the appointment itself fits inside published working hours.

**Occupancy** — whether the appointment *plus its buffers* clears every existing booking.

**Minimum notice** — how soon before an appointment you're still allowed to book it.

**Horizon** — how far into the future bookings are accepted.

**Exclusion constraint** — a PostgreSQL rule saying two rows may not have overlapping time
ranges for the same provider. The thing that makes double booking impossible.

**Advisory lock** — a temporary lock the application asks the database for, to make a few
competing requests take turns.

**Transactional outbox** — writing "an email needs to be sent" into the database as part of
the same transaction as the booking, so the two can never disagree.

**Snapshot** — copying a value onto a record at the time it happens, so later edits to the
original don't rewrite history.

**Soft delete** — marking something inactive instead of removing it, so its history survives.

**Idempotency** — the property that doing the same operation twice has the same effect as
doing it once.

**IANA timezone** — a named zone like `Asia/Kolkata` or `Europe/London` that carries its own
daylight-saving rules, as opposed to a fixed offset like `+05:30`.

**Pure function** — code that only uses what's passed to it and only returns a value. No
database, no clock, no side effects — which is what makes it easy to test exhaustively.

---

## Closing summary

If the whole project had to be reduced to three sentences:

1. **The backend decides everything about availability, and the browser only renders the
   answer** — so the UI can never offer a time the engine would refuse.
2. **Double booking isn't prevented by careful code, it's prevented by the database** —
   an overlapping appointment is impossible regardless of what tries to write it.
3. **Everything that must reflect the past is snapshotted, append-only, or both** — so
   history stays true even as the business changes its prices, its names and its staff.
