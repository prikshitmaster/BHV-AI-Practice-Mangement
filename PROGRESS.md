# PROGRESS.md

Read this file + SPEC.md + the current task in TASKS.md at the start of
every session — you don't need to re-read the whole PRD.md each time.

## How to update this file

After a task in TASKS.md passes its acceptance test, add one line below
and check the box in TASKS.md. Keep entries short — this is a log, not
a report.

Format: `YYYY-MM-DD — T## — <what was built> — tested against <which
acceptance evidence> — PASS`

If a task is blocked or a test fails, log that too, with the reason —
don't leave it silently unchecked.

## Log

- 2026-09-09 — T01.1 — Scaffolded Next.js (App Router, TypeScript,
  Tailwind, ESLint, src/, @/* alias, npm) at project root via
  create-next-app; git repo initialized. — not yet tested (scaffold
  only, T01 acceptance test runs after T01.5).
- 2026-09-09 — T01.3 — Added docker-compose.yml (app, db=postgres16,
  redis7, minio) + Dockerfile + .env.example. — not yet tested (no
  `docker compose up` run yet, waiting on T01.2 Prisma so the app image
  actually builds).
- 2026-09-09 — T01.4 — Added src/app/api/health/route.ts returning
  {status:"ok"}/200. — not yet tested (no server run yet).
- 2026-09-09 — T01.2 — Added Prisma 7: prisma/schema.prisma
  (HealthCheck placeholder), prisma.config.ts (DATABASE_URL),
  src/lib/prisma.ts using @prisma/adapter-pg; client generated to
  src/generated/prisma (gitignored). — tested: `prisma generate`
  succeeds; /api/health compiles and returns 503 {"db":"down"} with
  Postgres offline, which is the correct designed response — PASS
  (partial: 200/db:up path still needs the DB, see T01.5).
- 2026-09-09 — Added SETUP-EXPLAINED.md — plain-language walkthrough of
  every setup step, what each tool is for, and how to test locally.
- 2026-09-09 — T01.5 — Docker env unblocked (LxssManager was Disabled →
  set Automatic/Running via elevated helper; owner ran `wsl --update
  --web-download` for the missing WSL2 kernel; Docker Desktop restarted).
  Added .dockerignore + fixed Dockerfile (build-time placeholder
  DATABASE_URL for `prisma generate`). — tested against T01 acceptance
  evidence: `docker compose up -d --build` brings up app/db/redis/minio
  (db, redis, minio healthy); `prisma migrate dev --name init` applied
  migration 20260909001354_init cleanly; GET /api/health → 200
  {"status":"ok","db":"up"} from the containerised app; GET / → 200
  — PASS
- 2026-09-09 — T01 — COMPLETE. Scaffold (Next.js 16 + TS + Tailwind +
  Prisma 7 + Postgres 16 + Redis 7 + MinIO on Docker Compose) running
  and verified end to end. — PASS
- 2026-09-09 — T02 — Core data model, all 8 PRD §33 record-dictionary
  records (tenant/practice/registration/branch/team/user/membership,
  party/identifier/contact/authority/client relationship, engagement/
  job/task/checklist/dependency, obligation rule/obligation/change,
  document/version/release grant, invoice series/invoice/line/receipt/
  allocation, approval, event). DAT01 enforced structurally: every
  practice-scoped child carries practiceId and references its parent by
  COMPOSITE FK (id, practiceId), so Postgres itself rejects cross-practice
  references. Money Decimal(18,2)+currency, statutory dates @db.Date,
  archivedAt soft-delete (DAT03), issuedSnapshot/acceptedSnapshot and
  denormalised approval actor name (DAT02). Migration
  20260909002840_core_data_model. — tested against DAT acceptance
  evidence via `npm run test:t02` (tests/t02-data-model.ts, fictional
  data only): 13/13 assertions pass — cross-practice invoice→engagement
  rejected with FK violation P2003 (asserted on the error CODE, so it
  cannot pass for an incidental reason) while the same-practice
  reference is accepted; both practices issue sequence number 1 without
  collision; renaming a contact leaves the issued invoice snapshot and
  totals untouched; a DEACTIVATED user is still named in historical
  approvals and the User model holds no secret columns — PASS
- 2026-09-09 — T03 — Practice hierarchy & isolation (ORG01-05; ORG06
  deferred to R1). Added PracticeGroup, ORG02 verified-identity tables
  with effective dates (PracticeAddress/BankAccount/Letterhead/
  AuthorisedSignatory), per-practice documentNamespace, readOnlyFrom for
  deactivated practices, and ORG05 CrossPracticeShare. Migration
  20260909010000 written by hand (via `migrate diff`) so the new required
  documentNamespace column was BACKFILLED rather than dropping the
  existing rows. Built src/lib/practice-scope.ts as the single
  deny-by-default guard (live-membership resolution, PracticeAccessError
  returning 404 not 403 so a refusal cannot confirm a record exists,
  denials written to the Event audit trail), src/lib/session.ts as a
  fail-closed actor placeholder, six scoped API routes, the ORG03 firm
  switcher component, and the ORG05 share grant/revoke endpoint.
  — tested against ORG acceptance evidence via `npm run test:t03`
  (tests/t03-practice-isolation.ts, real HTTP against the running app,
  fictional data only): 23/23 pass — same client in both practices keeps
  distinct engagement letters, bank details, invoice series and document
  namespaces; an Associates-only user is refused Company records through
  ALL SIX paths (URL, API, search, export, email job, object link) while
  the Company user's own access still works; ORG05 grant resolves, a NEW
  document version does NOT inherit it, revocation stops access
  immediately; no actor header ⇒ 401 — PASS
  NOTE: the 7th path in the PRD evidence, AI retrieval, is R2 and does
  not exist yet — it must be added to this test when AI lands.
- NEXT STEP: T04 — roles & permissions, IAM01-06 (PRD §8). Builds on
  the T03 guard: add role definitions, assignment scope, separation of
  duties (an article cannot approve their own filing), and lifecycle
  (invite/suspend/revoke invalidating sessions and queued exports).
  Note T02 already laid the structural groundwork (Branch/Team/
  Membership tables + composite-FK isolation); T03 adds the firm
  switcher, per-practice permissions/credentials, explicit logged
  sharing grants, and the ORG acceptance test (Associates-only user
  denied Company records via URL, API, search, export, email job,
  object link).

## Open questions carried from SPEC/PRD review

- Actual registered practice names, FRNs, GSTINs, PANs, bank accounts,
  and signing authorities must be verified during onboarding (PRD status
  note) — do not hardcode B H Vyas identifiers before confirmation.
- Firm-controlled hosting vs. approved India-region cloud is still an
  open decision per PRD §46 — confirm before deploying past local dev.
- No production credentials, real client data, or live AI/email/filing
  integrations until the owner explicitly approves the tested
  configuration (PRD §45 "Instruction to give the engineer").
