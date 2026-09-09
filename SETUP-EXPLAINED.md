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

### Step 5 — Run the test (T01.5) ⏳ BLOCKED

Not done yet. See below.

---

## Where things stand right now

✅ **The website runs.** Open **http://localhost:3000** — it works today.
It shows the default starter page, because T01 is scaffold-only. Real
screens start at T07.

⏳ **The database is not running yet**, so `/api/health` cannot return
200 yet.

🔒 **The blocker is on your side.** Docker cannot start on this machine
because a Windows service called **WSL** (`LxssManager`) is switched to
**Disabled**. Docker on Windows runs its containers inside WSL, so with
WSL off, Postgres/Redis/MinIO cannot start. I cannot change this myself
because it needs Administrator rights.

### What you need to do

Open **PowerShell as Administrator** (right-click → Run as
administrator) and paste:

```powershell
Set-Service -Name LxssManager -StartupType Automatic
Start-Service LxssManager
wsl --install --no-distribution
```

Then restart Docker Desktop. If it asks you to reboot, reboot.

### What I will do after that

1. `docker compose up -d` → starts Postgres, Redis, MinIO
2. `prisma migrate dev` → creates the real tables in the database
3. Open `/api/health` → confirm it returns **200 `db:"up"`**
4. Tick T01 in `TASKS.md`, log it in `PROGRESS.md`
5. Start **T02 — the real data model** (clients, invoices, practices)

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
