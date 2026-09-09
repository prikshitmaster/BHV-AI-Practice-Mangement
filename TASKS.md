# TASKS.md — R0 Secure Core

Work top to bottom. For each task: read SPEC.md + the cited PRD.md
section only, ask Claude to restate its plan in 3-5 lines first, build,
then run the acceptance evidence before checking it off. Update
PROGRESS.md after each task passes.

Status legend: [ ] not started · [~] in progress · [x] done & tested

---

## Phase 0 — Foundation

- [x] **T01 — Project scaffold.** Next.js + TypeScript + Prisma +
  PostgreSQL + Docker Compose (app, db, redis, minio). No business logic
  yet — just a health-check route and a working migration.
  *Test: `docker compose up` succeeds; health route returns 200; a
  Prisma migration applies cleanly.*
  - [x] T01.1 — Scaffold Next.js (App Router) + TypeScript + Tailwind +
    ESLint app in project root via create-next-app, src/ dir, `@/*`
    alias, npm. Git repo initialized.
  - [x] T01.2 — Add Prisma: install deps, minimal placeholder schema
    (one `HealthCheck` model). Prisma 7 layout: URL lives in
    `prisma.config.ts`, generator `prisma-client` → `src/generated/prisma`,
    client built with `@prisma/adapter-pg` driver adapter.
  - [x] T01.3 — Add `docker-compose.yml`: `app` (Next.js), `db`
    (Postgres 16), `redis` (7), `minio` (latest, console + API ports),
    with named volumes and a `.env.example`.
  - [x] T01.4 — Add `/api/health` route returning `{status:"ok"}` with
    200.
  - [x] T01.5 — Run acceptance test: `docker compose up` succeeds,
    `prisma migrate dev` applies cleanly against the `db` service,
    `GET /api/health` returns 200.

- [x] **T02 — Core data model.** Implement DAT01-03 (PRD §33): Practice,
  PracticeMembership, Party/ClientRelationship, Engagement, Document,
  Invoice, Approval/Filing, Event tables per the record dictionary.
  Enforce nonblank owning-practice on every financial/professional record.
  *Test (DAT acceptance evidence): a Company invoice cannot reference an
  Associates engagement; changing a contact name does not alter a
  previously issued invoice.*
  - [x] T02.1 — Write `prisma/schema.prisma` covering all 8 records in
    the PRD §33 record dictionary.
  - [x] T02.2 — DAT01 practice consistency: composite `@@unique([id,
    practiceId])` + composite FKs so cross-practice references are
    rejected by Postgres, not just app code.
  - [x] T02.3 — DAT01 types: Decimal(18,2) money + explicit currency,
    `@db.Date` for statutory dates, UTC timestamps + practice
    jurisdiction timezone. DAT03: `archivedAt` soft-delete everywhere,
    purge kept separate.
  - [x] T02.4 — DAT02 snapshots: `issuedSnapshot` on Invoice,
    `acceptedSnapshot` on Engagement, denormalised actor name on
    Approval, effective intervals on roles/registrations/rules.
  - [x] T02.5 — `prisma generate` + `prisma migrate dev` apply cleanly.
  - [x] T02.6 — Write acceptance test script exercising the DAT
    evidence (cross-practice invoice rejected; contact rename leaves
    issued invoice untouched; deactivated user still named in approvals).
  - [x] T02.7 — Run the acceptance test, all assertions pass.

- [x] **T03 — Practice hierarchy & isolation.** Implement ORG01-06
  (PRD §7): Tenant/PracticeGroup/Practice/Branch/Team/Membership,
  firm switcher, separate invoice series/permissions/credentials per
  practice, explicit logged sharing grants.
  *Test (ORG acceptance evidence): create the same fictional client in
  both practices; verify different engagement letters, bank details,
  invoice series. An Associates-only user fails access via URL, API,
  search, export, email job, object link, AI retrieval for Company
  records.*
  - [x] T03.1 — Schema: `PracticeGroup` (ORG01) + ORG02 verified
    identity config with effective dates (`PracticeAddress`,
    `PracticeBankAccount`, `PracticeLetterhead`,
    `AuthorisedSignatory`) + ORG05 `CrossPracticeShare`. Migrate.
  - [x] T03.2 — `src/lib/practice-scope.ts`: deny-by-default
    server-side scope guard. Resolves a user's live memberships and
    throws `PracticeAccessError` for anything else. Nothing may query
    a practice-scoped table without going through it.
  - [x] T03.3 — Scoped API routes, each using the guard: practices
    list (switcher), invoice read, search, export, document object
    link, queued email job.
  - [x] T03.4 — Firm switcher UI (ORG03): active practice always shown
    in header; Combined view forces an explicit practice choice on
    create; switching context clears/revalidates the draft.
  - [x] T03.5 — ORG05 explicit sharing: logged grant naming receiving
    practice + purpose + expiry; new document versions do NOT inherit
    the grant; revoke blocks future access.
  - [x] T03.6 — Acceptance test script: same fictional client in both
    practices with distinct bank details / invoice series / engagement
    letters, and an Associates-only user denied Company records across
    all six access paths.
  - [x] T03.7 — Run the acceptance test, all assertions pass.

## Phase 1 — Identity & security

- [~] **T04 — Roles & permissions.** Implement IAM01-06 (PRD §8): deny-
  by-default server-side checks, role definitions, assignment scope,
  separation of duties, lifecycle (invite/suspend/revoke).
  *Test: a manager assigned to both firms sees only authorised teams; an
  article cannot approve their own filing; revocation invalidates active
  sessions and queued exports.*
  - [ ] T04.1 — Schema: IAM02 role set (Group Owner, Practice Partner,
    Manager, Reviewer, Staff/Article, Finance, HR, IT Admin, Quality
    Reviewer, Client Contact) via a mapped enum migration; IAM03
    `assignmentScope` + `PermissionGrant` for restricted areas (HR,
    credentials, fee rates, protected workpapers); IAM04
    `SelfReviewException`; IAM05 `Session` + `QueuedJob` so revocation
    has something to invalidate.
  - [ ] T04.2 — `src/lib/permissions.ts`: deny-by-default action matrix
    keyed on role + assignment scope + record sensitivity. IT control
    is separated from professional data authority (IAM02).
  - [ ] T04.3 — IAM04 separation of duties: the author of a filing or
    invoice cannot approve it; sole-reviewer situations require a
    disclosed self-review exception with reason + quality-review
    follow-up.
  - [ ] T04.4 — IAM05 lifecycle: invite → accept → suspend/revoke.
    Revocation invalidates active sessions AND cancels queued exports
    before further disclosure.
  - [ ] T04.5 — IAM01: background workers re-check membership at
    execution time, not just at enqueue time.
  - [ ] T04.6 — Acceptance test script covering all four evidence
    points.
  - [ ] T04.7 — Run the acceptance test, all assertions pass.

- [ ] **T05 — Authentication.** Implement AUTH01-05 (PRD §10): MFA login,
  session/recovery rules (30 min idle / 12 hr max), invitation bootstrap,
  DSC custody register (metadata only, no private keys).
  *Test: reset/MFA recovery works with the owner absent via a documented
  substitute process; no plaintext secrets in logs or backups.*

- [ ] **T06 — Security baseline.** Implement SEC01-06 (PRD §35): OWASP
  ASVS-aligned hardening, encryption at rest/in transit, audit trail
  (append-only), monitoring hooks, no public debug endpoints.
  *Test: audit trail captures actor/practice/action/version/time/reason
  for every sensitive change; independent pen-test finds no critical/high
  unresolved.*

## Phase 2 — Client & engagement core

- [ ] **T07 — Client registry.** Implement CLI01-06 (PRD §11): Party/
  ClientRelationship/Contact model, duplicate resolution, guided intake,
  acceptance/conflict check, Client 360 screen.
  *Test: onboard a fictional company with two GST registrations and
  engagements in both practices; reject an unauthorised email change;
  no cross-practice data leaks via autocomplete.*

- [ ] **T08 — Engagements.** Implement ENG01-06 (PRD §12): service
  catalogue templates, engagement record, letter generation, change
  control, closure/termination.
  *Test: change an accepted annual retainer to add litigation work — the
  original scope stays intact, a new fee/authority review appears,
  existing GST jobs are not recreated.*

## Phase 3 — Work & deadlines

- [ ] **T09 — Work model & queues.** Implement WRK01-05 (PRD §13):
  Engagement/Job/Task/ChecklistItem/ClientRequest, state machine,
  recurrence with dedup key, dependencies/blocking, saved queues.
  Defer WRK06 (automation designer) to R1.
  *Test: run the monthly job generator twice — only one job exists per
  key; reopening a completed job doesn't alter its filing evidence.*

- [ ] **T10 — Statutory calendar.** Implement DUE01-04, DUE06 (PRD §14):
  obligation rules, deadline instances, extensions with preview, alerts
  requiring acknowledgement evidence. Defer DUE05 (regulatory update
  inbox, AI-assisted) to R2.
  *Test: an extension applicable to one taxpayer class changes only
  matching open obligations; an obligation with unknown category stays
  in "Review required".*

## Phase 4 — Documents & communication

- [ ] **T11 — Document management.** Implement DOC01-04, DOC06 (PRD §15):
  intake with malware/MIME scanning, immutable versioned originals,
  classification, release/sharing with expiring links, retention/lock.
  Defer DOC05 (physical register) to R1.
  *Test: upload the same filename twice — both versions preserved;
  revoke a user — their signed object link and search results stop
  working immediately.*

- [ ] **T12 — Communication core.** Implement COM01-04 (PRD §16):
  unified context, structured client requests, outbound safeguards
  (recipient verification), reminder engine with duplicate keys.
  Defer COM05/06 to R1/R2.
  *Test: trigger the same reminder through two workers — only one
  logical message sends; a staff member switching practice cannot send
  a Company invoice from an Associates identity.*

- [ ] **T13 — Client portal.** Implement POR01-03, POR05 (PRD §17):
  portal home, contact authority with entity switcher, guided upload.
  Defer POR04 (approvals) and POR06 (external experts) to R1.
  *Test: a group CFO switches between two approved client entities and
  cannot see a third; interrupted upload resumes without duplicate
  originals.*

## Phase 5 — Billing register (R0 subset)

- [ ] **T14 — Fees & invoicing (core).** Implement FIN01, FIN02, FIN04
  (PRD §25): fee arrangements tied to engagement/practice, invoice
  identity with locked series, receipts/allocations. Defer FIN03
  (tax particulars), FIN05 (collections), FIN06 (accounting bridge) to R1.
  *Test: create identical invoice sequence numbers in separate practice
  series without collision; allocate a part payment and TDS deduction
  distinctly.*

## Phase 6 — Platform correctness

- [ ] **T15 — API contracts & concurrency.** Implement API01-03 (PRD §34):
  server-side auth on every endpoint, optimistic version checks, outbox-
  pattern event reliability.
  *Test: two reviewers approve different versions simultaneously — only
  the current version can be approved; two invoice-issue clicks create
  one invoice.*

- [ ] **T16 — Navigation & UX states.** Implement UX01-05, NAV01-04
  (PRD §38-39): light/dark themes, five states per screen, accessible
  identity cues, safe action confirmation.
  *Test: complete client onboarding, document review, and invoice issue
  using only the keyboard, in both themes.*

- [ ] **T17 — Reports shell.** Implement REP01 (PRD §40): filtered
  reports with refresh time, formula definition, record count; empty
  denominators show "Not available", never silently zero.

- [ ] **T18 — Backup & recovery.** Implement BCP01-04, BCP06 (PRD §37):
  encrypted backups in a separate failure domain, RPO ≤1hr/RTO ≤8hr
  targets, restore reconciliation, quarterly restore drill.
  *Test: restore a synthetic production copy into an isolated environment
  with external sending disabled; verify a random sample of file hashes,
  permissions, and receipt balances.*

---

## After R0 is complete

Re-read PRD §6 exit gate for R0: "Cross practice isolation, restore
drill and realistic client workflow pass." Run the full §42 acceptance
scenario table before starting R1. Then create `TASKS-R1.md` following
the same pattern, using PRD §18-24, §26-28 and the R1 rows of the §47-49
traceability index.
