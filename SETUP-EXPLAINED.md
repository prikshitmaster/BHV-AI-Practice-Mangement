# SETUP-EXPLAINED.md — What I built, in plain English

This file explains **every step taken to set up this project**, what each
piece is for, and what you need to do. No jargon. Read top to bottom.

For the formal task list see `TASKS.md`. For the running log see
`PROGRESS.md`. This file is the "explain it simply" version.

---

## The big picture

We are building **BHV Practice Management** — software for a chartered
accountancy firm to manage clients, deadlines, documents, and invoices
for two separate practices that must never see each other's data.

We are not building it all at once. It is split into **18 tasks (T01 to
T18)**, and each task is split into **micro-steps** (T01.1, T01.2, ...).
We finish one, test it, write it down, then move to the next. This is
the whole point: small steps mean fewer mistakes and you can stop and
restart anytime without losing your place.

**Right now we are on T01 — the scaffold.** That means: no business
features yet, just the empty skeleton of the app, proven to run.

---

## The parts we are installing, and why

Think of it like setting up a new office before any staff move in.

| Part | What it actually is | Why we need it |
|---|---|---|
| **Next.js** | The website framework | Runs both the screens you see and the server logic behind them, in one codebase |
| **TypeScript** | JavaScript with type checking | Catches mistakes while writing, not after a client sees them |
| **Prisma** | A translator between our code and the database | Lets us write `findUser()` instead of raw SQL, and safely change the database over time |
| **PostgreSQL** | The database | Where every client, invoice, and deadline is actually stored |
| **Redis** | A fast temporary memory store | Holds the queue of background jobs (reminder emails, imports) |
| **MinIO** | A private file storage server | Stores client documents as versioned files, on your own machine — not someone else's cloud |
| **Docker** | Runs all of the above in isolated boxes | So Postgres/Redis/MinIO start with one command and behave identically on any machine |

**Why MinIO and not Google Drive/Dropbox?** The spec (PRD) requires the
firm to control its own document storage, with version history and
encryption. That is a hard requirement, not a preference.

---

## Step by step: what I actually did

### Step 1 — Created the app skeleton (T01.1) ✅

Ran `create-next-app` to generate a working Next.js website.

**What you got:** a real, running website with a homepage.
**Where:** `src/app/page.tsx` is the homepage, `src/app/layout.tsx` wraps
every page.

Small snag: the folder is named `TASK TWO` with a capital letters and a
space, which npm refuses as a project name. So I generated it in a temp
folder as `bhv-practice-management` and moved the files in. Same result.

### Step 2 — Set up the database translator (T01.2) ✅

Installed Prisma and wrote `prisma/schema.prisma`.

**What a "schema" is:** a plain-text description of your database tables.
You write the shape you want, Prisma creates the real tables for you.

Right now it holds one throwaway table called `HealthCheck` — just proof
the plumbing works. **The real tables (clients, invoices, engagements)
come in T02.** We do not invent them early.

Snag: Prisma released version 7, which moved the database password out
of `schema.prisma` into a separate `prisma.config.ts` file, and now
requires a "driver adapter" (`@prisma/adapter-pg`) to talk to Postgres.
I checked the official docs rather than guessing, and rewired it.

**Files:** `prisma/schema.prisma` (table shapes), `prisma.config.ts`
(where the database lives), `src/lib/prisma.ts` (the connection our code
imports).

### Step 3 — Wrote the "start everything" file (T01.3) ✅

Created `docker-compose.yml`.

**What it does:** one command — `docker compose up` — starts Postgres,
Redis, and MinIO together, already configured to talk to each other.
Without it you would install and configure three servers by hand.

Also created:
- `Dockerfile` — instructions for packaging our app into a box too
- `.env` — the real passwords/addresses for local development
- `.env.example` — a copy with no real values, safe to share

**Important:** `.env` is in `.gitignore`, so passwords never get
committed. The passwords in there now are throwaway development ones.
No real firm credentials go in this repo, ever — that is a hard rule in
`PROGRESS.md`.

### Step 4 — Added a health check page (T01.4) ✅

Created `src/app/api/health/route.ts`.

**What it does:** visit `/api/health` and it tries to talk to the
database, then answers:
- `{"status":"ok","db":"up"}` with code 200 → everything works
- `{"status":"degraded","db":"down"}` with code 503 → database unreachable

**Why it matters:** it is the single fastest way to know if the system is
healthy, and it is exactly what T01's acceptance test checks.

### Step 5 — Run the test (T01.5) ✅

Docker wouldn't start: Windows had the **WSL** service (`LxssManager`)
set to **Disabled**, and Docker on Windows runs containers inside WSL.
I enabled the service, you ran `wsl --update --web-download` to fetch the
missing WSL2 kernel, and Docker came up. Then all four containers
started, the migration applied, and `/api/health` returned **200
`{"status":"ok","db":"up"}`**. T01 passed.

---

## What was built after the scaffold

### T02 — The real data model ✅

Created all the tables the firm actually needs: practices, staff,
clients, engagements, jobs, documents, invoices, approvals, and an audit
log.

**The important idea here:** the database itself refuses to mix the two
practices. Every record carries the practice it belongs to, and links
between records check the practice matches. So a Company invoice
*physically cannot* point at an Associates engagement — Postgres rejects
it. It's not a rule the code politely follows; it's a wall.

Also: money is stored as exact decimals (never floating point, which
loses pennies), and an issued invoice keeps a frozen copy of its details.
Rename a client contact next year and last year's invoice is untouched.

**Tested:** 13 checks, all passing.

### T03 — Keeping the two practices apart ✅

The PRD demands that someone who works only at Associates cannot reach
Company records through **six different routes**: typing the URL, calling
the API, searching, exporting a spreadsheet, sending an email, or opening
a document link.

I built a single gatekeeper that every one of those routes must pass
through, and it says "no" unless proven otherwise. It returns "not found"
rather than "forbidden" — because "forbidden" would itself confirm the
record exists.

There's also a proper sharing mechanism: one practice can share a
specific document with the other, but the grant must name a reason and an
expiry, a *new version* of that document is not automatically shared, and
revoking cuts access immediately.

**Tested:** 23 checks, all passing — including all six routes.

### T04 — Who is allowed to do what ✅

Ten roles (Partner, Manager, Reviewer, Article, Finance, IT Admin, and so
on). Two deliberate design points:

- **The IT administrator cannot approve filings or see client records.**
  They keep the system running; they have no professional authority.
  Equally, a partner cannot administer the system. Mixing those two is
  how an IT account ends up able to sign off accounts.
- **You cannot approve your own work.** An article can prepare a filing
  but not approve it. For invoices there's a value threshold. If someone
  genuinely is the only reviewer available, they must record a written
  exception — which is logged and leaves a quality-review obligation
  behind. For statutory filings, no exception is possible at all.

When someone leaves, suspending them kills their live sessions *and*
cancels their queued exports in one operation — and any background job
double-checks permission again at the moment it runs, not just when it
was queued.

**Tested:** 37 checks, all passing.

### T05 — Logging in ✅

Email + password + an authenticator app code. A correct password alone
never logs you in.

- Passwords are stored as scrypt hashes — the real password is never
  saved anywhere.
- The authenticator seed is encrypted with a key kept *outside* the
  database, so a stolen database backup yields no working codes.
- Sessions expire after 30 minutes idle or 12 hours absolute, enforced by
  the server on every request, and can be revoked instantly.
- Exports, role changes and revealing secrets require re-entering your
  code (a "step-up").
- **"admin/admin" is impossible** — banned passwords are rejected at the
  moment someone tries to set one.

**The headline test:** MFA recovery *with the owner away*. It needs a
second authorised person to approve, the person recovering cannot approve
their own request, and recovery never switches MFA off — it forces you to
set it up again.

**And a real proof, not a promise:** the test takes an actual database
dump and searches it for the exact password, authenticator seed, session
token and recovery codes used in that test run. None appear.

**Tested:** 54 checks, all passing.

### T06 — Security baseline ✅ (mostly)

The audit log is now **physically impossible to edit or delete** — Postgres
itself rejects the attempt, even from the database owner. Each entry is also
chained to the one before it with a fingerprint, so if anyone did tamper
with the database directly, the chain breaks and we can prove it.

Also added: security headers on every page, CSRF protection, and monitoring
that raises an alert on repeated failed logins, unusually large exports, or —
most importantly — anyone repeatedly probing the other practice's data.

Alerts deliberately carry **counts and IDs only, never document contents**,
so sending an alert to a chat channel can't itself become a data leak.

**Tested:** 44 checks passing.

**Not finished, and I can't finish it:** the PRD requires an **independent
penetration test** before production. That needs an outside expert. It's
logged as an open blocker and T06 is deliberately left unticked.

### T07 — Client registry ✅

Onboarding clients: one company can hold several GST registrations without
being duplicated, and the same company can be a client of *both* practices
with completely separate records.

Two details worth knowing:

- **Duplicate detection that doesn't leak.** If you try to add a client whose
  PAN already exists in the *other* practice, you're warned — but you're not
  told the name, or even which practice. Enough to stop you creating a
  duplicate, not enough to learn who the other practice acts for.
- **Changing a client's email is not a simple edit.** It's a request that
  needs staff authorisation, because that address receives statutory
  correspondence and password resets. Rejected attempts are kept, with
  evidence — because an attempt to redirect a client's mail is itself
  something you want a record of.

**Tested:** 55 checks passing.

### T08 — Engagements ✅

Service templates, engagement letters, and change control.

The important behaviour: **an accepted engagement is never edited.** If a
client on a GST retainer asks you to also handle litigation, that creates a
*revision*. The original keeps exactly the terms the client accepted, a fee
review and an authority review are raised automatically, and — critically —
the months of GST work already done are **not** duplicated onto the revision.

Also: you can't approve your own engagement letter, typed consent isn't
accepted for a statutory audit (a name typed in a box is not a signature),
and an independence concern blocks the job from starting until a *qualified
reviewer who isn't the job owner* signs it off.

**Tested:** 55 checks passing.

### T09 — Work, jobs and queues ✅

Recurring work (monthly GST returns and the like), the states a job moves
through, and the staff queues: My work, Team work, Review queue, Waiting
for client, Overdue.

Three behaviours worth knowing:

- **Running the monthly generator twice doesn't duplicate anything** — and
  neither does editing the service template. That second part is the subtle
  one: if the template version were part of how we detect duplicates, a
  small edit would silently regenerate every open job.
- **Asking for changes after review cancels the earlier approval.** Not by
  deleting it — the old approval stays as history — but because it no
  longer matches the current version of the work.
- **Reopening a completed job keeps everything.** The filing reference, the
  completion date and the full history all survive; reopening only adds to
  the record.

Also: a client being slow pauses *our* internal clock, but never moves the
legal deadline, and chasing continues regardless.

**Tested:** 60 checks passing.

### T10 — Statutory calendar ✅

Deadlines, extensions and reminders.

- **Five separate dates** per obligation — the legal date, our internal
  target, the review target, the client document cutoff and the payment
  date. Collapsing these into one "due date" is how an internal target
  quietly becomes the date everyone believes is the law.
- **Extensions preview before they apply.** A notification covering only
  audit cases moves only audit cases — not the non-audit ones, not
  already-filed returns, not returns under the other Act. Both the original
  and the new date stay visible, with the notification that authorised it.
- **"We don't know" is not "doesn't apply."** An obligation whose category
  or form can't be determined sits visibly in *Review required*. It can't
  be dismissed without someone stating a determination.
- **A bounced reminder is never proof the client was told.** It can't even
  be marked as acknowledged.
- **Both income tax regimes coexist** — the 1961 Act and the 2025 Act — with
  the law, assessment year and tax year stored separately, so the filing
  date alone never decides which Act applies.

**Tested:** 56 checks passing.

---

## Where things stand right now

✅ **397 automated checks passing across everything built so far.**

**10 of 18 tasks done** (T01–T10; T06 is complete except for the outside
penetration test). Next up is T11 — document management.

### A real bug the tests caught, worth mentioning

While re-running the whole suite after T10, a test failed that had passed
minutes earlier. The cause was genuine: a deadline extension issued for one
firm was matching **another firm's** identical deadlines, because tax rules
are shared across firms while the deadlines are not. Left alone, one client's
extension notice could have moved a different client's legal deadline.

It's fixed, and there's now a permanent test that creates a second firm with
an identical deadline and proves it isn't touched.

This is the argument for re-running everything after each task rather than
just the newest test — the first run passed.

**What you can see today:** http://localhost:3000 and
`/api/health`. There are still no client-facing screens — those start at
**T07 (client registry)**. Everything so far is the foundation: the
database, the isolation walls, permissions, and login. That ordering is
deliberate; retrofitting practice isolation onto finished screens is how
these projects leak data.

### One decision that needs your review

`SPEC.md` chose **Auth.js** for authentication. I did not use it, and you
should know why: the PRD requires sessions to be revocable *immediately*
(when someone is walked out of the building). Auth.js's default token
sessions stay valid until they expire, no matter what — you can't call
them back. So sessions are stored in the database instead, which makes
instant revocation real.

Auth.js can still be added later for the login screen itself. But this is
a genuine departure from the written plan, so it's flagged in
`PROGRESS.md` for you to accept or overrule.

---

## How to test it yourself, anytime

| What | Command / URL | Expected |
|---|---|---|
| Start the website | `npm run dev` | Terminal says ready on port 3000 |
| See the app | http://localhost:3000 | A page loads |
| Check system health | http://localhost:3000/api/health | `{"status":"ok","db":"up"}` once the DB is up |
| Start the databases | `docker compose up -d` | Three containers running |
| See what's running | `docker compose ps` | db, redis, minio all "healthy" |
| Stop everything | `docker compose down` | Containers stop, data is kept |
| Browse stored files | http://localhost:9001 | MinIO login screen |

---

## The rules we never break (from SPEC.md)

These are why the app is built carefully rather than quickly:

1. **Every database question filters by practice, on the server.** A user
   of one practice must never see the other's data — and we never rely on
   just hiding it in the interface.
2. **No silent overwrites** on approvals, deadlines, or signed documents.
   If two people edit at once, one gets told, not silently discarded.
3. **Issued invoices and filed forms never change** afterwards. History
   stays history.
4. **Every screen handles five situations:** normal, empty, loading,
   error, and "you're not allowed".
5. **AI never decides anything.** It may draft; a human approves. (And no
   AI features at all until much later — release R2.)
