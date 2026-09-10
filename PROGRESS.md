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
- 2026-09-09 — T04 — Roles & permissions (IAM01-05; IAM06 delegation/
  break-glass deferred to R1). Migration 20260909020000 replaced the
  placeholder role enum with the IAM02 set, MAPPING existing rows
  (SENIOR→REVIEWER, ADMIN→IT_ADMIN etc.) rather than dropping them;
  added assignmentScope, PermissionGrant, SelfReviewException, Session,
  QueuedJob, and Practice.invoiceApprovalThreshold. New modules:
  src/lib/permissions.ts (deny-by-default action matrix; IT_ADMIN has
  system control but no professional data authority, and no
  professional role can administer the system), src/lib/
  separation-of-duties.ts (authorship read from the audit trail, not an
  editable field; FILING can never be self-approved even by disclosure),
  src/lib/user-lifecycle.ts (suspend revokes sessions + cancels queued
  AND running exports in ONE transaction, so no gap opens between the
  two; workers re-check membership at execution time).
  — tested against IAM acceptance evidence via `npm run test:t04`: 37/37
  pass — a manager in both firms reaches only their own team in each and
  nothing in a third practice; an article cannot grant access or approve
  their own filing; suspension invalidates the live session and cancels
  both queued and running exports; a worker starting a job after
  revocation aborts on re-check while a valid requester's job proceeds;
  the suspended account is preserved so authorship survives — PASS
- 2026-09-09 — REGRESSION FIX — re-running T02 after T04 caught a
  failure: the "no secret columns on User" assertion used an over-broad
  regex that flagged the new `mfaEnrolledAt` timestamp. IAM05 explicitly
  requires recording MFA enrolment, and a timestamp is not secret
  material, so the ASSERTION was tightened (password/passphrase/secret/
  privatekey/recoverycode/apikey/totp/sessiontoken/hash) rather than the
  schema changed. Full suite now: T02 13/13, T03 23/23, T04 37/37 = 73
  assertions green. `npm test` runs all three.
- 2026-09-09 — T05 — Authentication (AUTH01, AUTH02, AUTH03, AUTH05;
  AUTH04 portal secret vault is R1 and AUTH06 SSO is R2, both deferred).
  Migration 20260909030000 added UserCredential, MfaEnrolment (seed
  AES-256-GCM encrypted under an env-held key), MfaRecoveryCode (hashed),
  Invitation, RecoveryRequest, DscCustodyRecord, RateLimitCounter,
  StepUpChallenge, and a hashed token on Session. New modules:
  src/lib/crypto.ts (scrypt N=2^16 passwords, AES-256-GCM, RFC 6238 TOTP
  with per-step replay prevention, constant-time comparison — all on
  node:crypto, nothing hand-rolled) and src/lib/auth.ts. src/lib/
  session.ts now validates a real DB-backed session cookie; the T03 dev
  actor header survives for the test suites but is blocked in production
  by assertNoDevAuthInProduction().
  — tested via `npm run test:t05`: 54/54 pass, including the two headline
  acceptance items. MFA recovery with the OWNER ABSENT works through a
  named substitute approver (and the subject cannot approve their own
  request), and recovery REVOKES the old enrolment and forces
  re-enrolment rather than switching MFA off. The plaintext-secret search
  is done for real: a genuine `pg_dump` plus the audit trail are searched
  for the actual password, TOTP seed, session token, invitation token,
  recovery token and recovery codes used in the run — none appear, with a
  control assertion proving the search can find a known stored value.
  Demo credentials ("admin", "admin123", "password", …) are refused at
  the point a password is SET, so an admin/admin account cannot be
  created, let alone deployed — PASS
- DECISION (needs owner review): SPEC.md §1 names Auth.js for auth.
  AUTH02 requires "server enforced expiry ... and immediate revocation",
  which a stateless JWT cannot provide — a signed token stays valid until
  it expires regardless of a walkout. Sessions are therefore
  database-backed, reusing the T04 Session table that suspendUser()
  already revokes. Auth.js can still be layered on later as a login-flow
  front end; the authority stays in src/lib/auth.ts. Flagging because it
  diverges from the written SPEC.
- 2026-09-09 — Full regression suite green: T02 13, T03 23, T04 37,
  T05 54 = 127 assertions. `npm test` runs all four.
- 2026-09-09 — T06 — Security baseline (SEC01-06), PARTIAL — see blocker
  below. Migration 20260909040000 makes the audit trail genuinely
  append-only IN THE DATABASE: triggers reject UPDATE and DELETE on
  Event (verified to fire even for the table owner), and a SHA-256 hash
  chain is computed inside the INSERT trigger so the application cannot
  supply a forged hash. Added targetVersion (SEC04 "exact version") and
  the SecurityAlert model. New modules: src/lib/audit.ts (single write
  path + sanitiseMeta redaction + verifyAuditChain, which independently
  recomputes the chain in TypeScript and matches what Postgres computed),
  src/middleware.ts (CSP with no inline script, HSTS in production only,
  frame denial, nosniff, referrer and permissions policy, X-Powered-By
  removed), src/lib/csrf.ts (SameSite + origin check + double submit),
  src/lib/monitoring.ts (SEC05 detection sweep). SECURITY.md records the
  ASVS L2 control mapping WITH its gaps rather than overclaiming.
  — tested via `npm run test:t06`: 44/44 pass — every SEC04 field
  captured; UPDATE and DELETE on the trail rejected; an app-supplied hash
  discarded and recomputed; passwords/TOTP seeds/tokens redacted and a
  5000-char document body truncated while harmless metadata survives;
  live security headers asserted against the running app; repeated
  cross-practice probing escalates to CRITICAL; alert evidence carries
  counts but no secret or file body — PASS
- BLOCKER (T06 stays [~], NOT closed): the task's own acceptance test
  requires "independent pen-test finds no critical/high unresolved", and
  PRD SEC01 makes independent authorisation and penetration testing a
  release condition, with isolation failures blocking release outright.
  This CANNOT be performed from inside the project — it needs an external
  reviewer. T06's parent checkbox is deliberately left unchecked.
  Also outstanding before production, per SECURITY.md: no least-privilege
  DB role (the app connects as the owner in dev, so a superuser could
  disable the append-only triggers); no key-rotation routine for
  APP_ENCRYPTION_KEY; no dependency/secret scanning in CI; hosting
  decision still open (PRD §46).
- 2026-09-09 — Regression suite: T02 13, T03 23, T04 37, T05 54, T06 44
  = 171 assertions, all green.
- 2026-09-09 — T07 — Client registry (CLI01-04, CLI06; CLI05
  continuance is R1, deferred). Migration 20260909050000 added
  VerificationStatus/FieldSource to identifiers and contact channels,
  stateCode/label on PartyIdentifier (several GST registrations on ONE
  party), PartyGroupLink, ContactChangeRequest, AcceptanceCheck and
  IntakeDraft. New modules: src/lib/client-registry.ts (CLI02
  non-revealing duplicate detection, format-check-is-not-verification,
  per-service required fields, conflict screening that returns counts
  not names) and src/lib/contact-authority.ts. New routes:
  clients/autocomplete, clients/duplicate-check, clients/[id] (CLI06
  Client 360 with per-tab permission gating).
  — tested via `npm run test:t07`: 55/55 pass — a fictional company with
  TWO GST registrations in different states on one party, a director
  contact, and engagements in BOTH practices; an unauthorised email
  change REJECTED with its source evidence and proposed value retained
  as evidence; autocomplete and duplicate detection leak nothing across
  practices (the out-of-scope duplicate warning carries no name, id or
  practice, yet still tells staff to consult master data); Client 360
  tabs gate independently, and a group link does NOT confer access — PASS
- 2026-09-09 — BUG FOUND AND FIXED BY THE TEST: approveContactChange()
  originally REJECTED the whole request when the requester tried to
  self-approve. That turned a refused approval into a way to destroy
  someone else's legitimate request. Now the refusal is audited and the
  request stays PENDING for a valid approver; a regression assertion
  covers it.
- 2026-09-09 — Also fixed: errorResponse() now returns the error message
  and a short stack OUTSIDE production only. A stale Turbopack-cached
  Prisma client had been failing with a bare 500 and no way to see why;
  a dev server restart is required after `prisma generate` adds fields.
- 2026-09-09 — Regression suite: T02 13, T03 23, T04 37, T05 54, T06 44,
  T07 55 = 226 assertions, all green. `npm test` runs all six.
- 2026-09-09 — T08 — Engagements (ENG01-04, ENG06; ENG05 full
  independence linkage is R1, but the independence BLOCK that gates
  activation is built here because activation control is R0). Migration
  20260909060000 added ServiceTemplate, ENG02 particulars on Engagement
  (scope/exclusions/feeBasis/billing entity/planned dates/retainer vs ad
  hoc/revision links/closure kind), EngagementLetter, EngagementChange,
  EngagementBlock. New module src/lib/engagements.ts.
  — tested via `npm run test:t08` (library level, no HTTP needed):
  55/55 pass. The headline evidence: adding litigation work to an
  ACCEPTED annual retainer creates a REVISION — the original's scope,
  exclusions, fee basis and acceptedSnapshot are all byte-identical
  afterwards, a FEE review and an AUTHORITY review both appear as
  explicit blocks on the revision, the revision is PENDING_ACCEPTANCE
  rather than silently active, and the three existing monthly GST jobs
  stay on the original with ZERO recreated (still 3 in total, not 6).
  An independence block prevents activation, and neither the engagement
  owner nor an article can clear it — only an eligible reviewer, whose
  professional conclusion is retained. Typed consent is refused for a
  statutory audit (a name in a box is not a signature), practice
  reassignment is refused without documented client arrangements, and
  outstanding fees stay traceable after closure — PASS
- 2026-09-09 — INFRASTRUCTURE FIX (affects everything): src/lib/prisma.ts
  now configures the pg pool explicitly (max 10, 30 s idle, 10 s connect
  timeout, keepAlive). Prisma 7 resolves a nested `include` by running
  sub-queries in PARALLEL, so one logical read can need several
  connections at once; at pool defaults, opening those mid-query
  intermittently surfaced as an opaque P1017 "Server has closed the
  connection" whenever the host was under memory pressure. This machine
  has ~1.2 GB free of 7 GB and had already had a dev server killed for
  low memory. Diagnosed by bisection — the same query passed standalone
  and failed after a burst of writes.
- 2026-09-09 — T08 test-quality fix worth noting: three assertions
  originally "passed the wrong way". They claimed to test a
  self-approval / client-arrangements guard, but a DIFFERENT correct
  guard fired first (the actor lacked engagement.accept; the engagement
  was not yet accepted). Behaviour was right, the assertions were not
  testing what they said. Rewritten so the specific guard is actually
  exercised — a second partner and an accepted engagement were added so
  the actor genuinely holds approval authority.
- 2026-09-09 — Regression suite: T02 13, T03 23, T04 37, T05 54, T06 44,
  T07 55, T08 55 = 281 assertions, all green.
  NOTE for future sessions: T03, T06 and T07 make real HTTP calls and
  need `npm run dev` running; T02, T04, T05 and T08 do not. A freshly
  started dev server compiles routes on first request, so the first
  HTTP-dependent run after a restart can show spurious failures — re-run
  once warm before believing them.
- 2026-09-09 — T09 — Work model & queues (WRK01-05; WRK06 automation
  designer is R1). Migration 20260909070000 replaced JobState/TaskState
  with the full WRK02 `WorkState` set, MAPPING existing rows rather than
  dropping the column (Prisma's generated diff would have discarded every
  recorded state; BLOCKED→WAITING_INTERNALLY, NOT_STARTED→READY, and the
  20 existing COMPLETED jobs were verified preserved). Added
  WorkStateTransition, ClientRequest, TimeEntry, WorkReassignment, and
  WRK01 fields (priority, estimate, tags, checklist requiredRole /
  notApplicableReason, dependency evidence). New module src/lib/work.ts.
  — tested via `npm run test:t09` (library level): 60/60 pass. All three
  evidence points: running the monthly generator twice creates 4 jobs
  then 0 — and crucially, bumping the TEMPLATE VERSION still creates 0,
  because the version is snapshot metadata and not part of the dedup
  identity (that is the trap WRK03 is written to prevent); requesting
  changes after review bumps the job version so the earlier approval
  stops being current while remaining in history as a stale record
  (nothing is mutated, per DAT02); and reopening a completed job leaves
  its filing evidence, ARN reference and completion timestamp untouched
  while the transition log only grows. Also verified: a client delay
  pauses the internal SLA clock and leaves the statutory date on the
  Obligation completely untouched — PASS
- 2026-09-09 — The T09 migration was made FULLY IDEMPOTENT (guards on
  every CREATE TYPE/TABLE/INDEX/CONSTRAINT and on the enum conversion)
  after a partial-apply failure: because I replaced Prisma's
  `DROP COLUMN state` with an `ALTER COLUMN ... USING`, the old index
  survived and the later CREATE INDEX collided. Prisma does not wrap
  these migrations in a transaction, so a mid-file failure leaves
  partial state — worth knowing before hand-editing any future
  migration.
- 2026-09-09 — OPERATIONAL NOTE (this bit twice): after ANY
  `prisma generate` that adds fields, the running `npm run dev` server
  must be RESTARTED. Turbopack caches the generated client, and the
  stale copy fails with a bare HTTP 500 on routes using the new fields.
  T07's Client 360 assertions were the casualty both times. The T07 test
  now prints the server's own devMessage alongside the status code so
  this is obvious next time rather than looking like flakiness.
- 2026-09-09 — Regression suite: T02 13, T03 23, T04 37, T05 54, T06 44,
  T07 55, T08 55, T09 60 = 341 assertions, all green (T07 confirmed
  stable over 3 consecutive runs).
- 2026-09-09 — T10 — Statutory calendar (DUE01-04, DUE06; DUE05
  regulatory update inbox is R1 per the PRD — note TASKS.md said R2, the
  PRD is authoritative, and either way it is not in R0). Migration
  20260909080000 added the DUE01 rule particulars (jurisdiction,
  governing law, service, taxpayer category, form version, due-date
  EXPRESSION, authoritative source + date, approving CA) with a
  Draft/Reviewed/Active/Superseded/Retired lifecycle; the DUE02 separate
  dates (original statutory, current statutory, internal target, review
  target, client cutoff, payment deadline); the DUE04 status set via a
  mapped enum migration; and StatutoryExtension, ObligationAlert and
  FilingEvidence. New module src/lib/statutory-calendar.ts.
  — tested via `npm run test:t10`: 56/56 pass. All four evidence points:
  an extension for ONE taxpayer class moved both open audit cases and
  left the non-audit case, the already-FILED case and another Act's
  obligation untouched; the audit trail carries BOTH dates (original
  preserved, current extended) with the authorising notification linked;
  an obligation with unknown category/form stays visible in
  REVIEW_REQUIRED and cannot be half-resolved or silently dismissed; and
  a BOUNCED reminder is neither evidence of receipt nor even
  acknowledgeable. Also: both income-tax regimes coexist with law,
  assessment year and tax year stored INDEPENDENTLY, so the filing date
  never selects the Act.
- 2026-09-09 — CROSS-TENANT BUG FOUND BY THE REGRESSION RUN (important):
  previewExtension() matched obligations only on rule code/jurisdiction,
  and ObligationRule has NO tenantId (its unique key is code+version,
  shared across tenants). A notification issued for one firm therefore
  counted — and would have MOVED — another tenant's identical
  obligations. Fixed by binding both the candidate and excluded-count
  queries to `practice: { tenantId: ext.tenantId }`. A regression
  assertion now creates a second tenant with an identical audit case on
  the identical date under the identical rule and proves it is neither
  previewed nor moved. Caught only because the suite is re-run in full
  after every task — the first run passed.
- 2026-09-09 — Regression suite: T02 13, T03 23, T04 37, T05 54, T06 44,
  T07 55, T08 55, T09 60, T10 56 = 397 assertions, all green.

- 2026-09-09 — T11.1 — Document schema + migration 20260909090000_documents
  applied and client regenerated. Purely ADDITIVE (every new column on the
  existing Document/DocumentVersion tables has a default, nothing dropped or
  retyped), written idempotently. Added: DOC01 `DocumentIntake` (a row for
  every upload ATTEMPT, including rejected/quarantined ones that never became
  a document, with coded + free-text rejection reasons), DOC02 version
  status/approval/derivation fields, DOC03 `DocumentClassification` (draft
  metadata with source reference and correction chain), DOC04
  `DocumentRelease` + `DocumentReleaseRecipient` + `DocumentAccessToken` +
  `RedactionReview`, DOC06 `DocumentSet`/`DocumentSetEntry`/
  `RetentionPolicy`/`LegalHold`/`DeletionRequest`. — not yet tested.
- 2026-09-09 — T11.2 — src/lib/object-store.ts: S3-compatible storage over
  hand-written AWS SigV4 on node:crypto (no new dependency; SPEC.md §1 wants
  MinIO swappable for India-region S3 by configuration). Keys are
  content-addressed under the practice `documentNamespace` (ORG04), so an
  altered byte lands on a different key and cannot overwrite an original, and
  quarantined bytes live under a separate `quarantine/` prefix no document
  route can reach. — tested: signed PUT/GET/HEAD/DELETE and a presigned GET
  all verified against the running MinIO container (round-trip byte-equal,
  404→null after delete) — PASS
  DESIGN NOTE: `presignGet` is deliberately marked server-to-server only. A
  presigned URL is a bearer credential valid until expiry no matter what
  happens to the holder's access, so it can never satisfy DOC04's "revoke on
  permission change". User-facing links go through `DocumentAccessToken`,
  re-authorised against live state at every redemption.
- 2026-09-09 — T11.3 — src/lib/document-intake.ts (DOC01): allow-listed types,
  MIME decided from magic bytes and only COMPARED with the declared type
  (which is attacker-controlled evidence, never trusted), separate size and
  DECOMPRESSION limits — the zip central directory is read without expanding
  anything, so inspecting a bomb cannot itself become the denial of service —
  encrypted archives refused because they cannot be scanned, pluggable
  malware scanner that FAILS CLOSED (an unreachable scanner holds the file
  rather than admitting it), and coded + actionable rejection reasons. A
  rejected or quarantined file never becomes a Document but always leaves a
  DocumentIntake row. Portal uploads are authorised by live contact
  UPLOAD authority, staff uploads by practice membership; there is no
  anonymous path. — typechecks; behaviour tested at T11.9.
- 2026-09-09 — T11.4-T11.7 — src/lib/documents.ts. DOC02: a second upload of
  the same filename becomes version n+1 and the previous version is marked
  superseded, never edited or moved; OCR/conversion/redaction go through
  createDerivative(), which refuses a derivative byte-identical to its source
  (a "redaction" that removed nothing); the preparer of a version cannot
  approve it (IAM04). DOC03: searchDocuments() derives results, the COUNT and
  the autocomplete suggestions from one authorised query — a total that counts
  records the user cannot open has already disclosed them — and protected
  working papers stay invisible per practice without the IAM03 grant; OCR/AI
  output lands as DRAFT DocumentClassification and only a CONFIRMED value
  reaches the Document, with corrections written as new rows linked to what
  they replaced. DOC04: releaseVersion() refuses an unapproved version, an
  internal working paper, a redaction whose four hidden-layer checks are not
  all confirmed, and any recipient without live contact authority;
  redeemAccessToken() re-authorises against live state on EVERY use, so
  suspension breaks an existing link on the next use with no revocation sweep.
  DOC06: finaliseSet() writes a manifest of version ids + hashes and hashes
  the manifest itself, locking its documents; deletion runs three separate
  gates (eligibility — refused under legal hold, a finalised set, a live
  release, or an unexpired/absent retention policy — then approval by someone
  other than the requester, re-checked at approval time, then logged
  execution) and the Document/version rows SURVIVE archived with their hashes,
  so what was destroyed stays provable. suspendUser() now also revokes the
  user's document links inside the same transaction. — typechecks; behaviour
  tested at T11.9.
- 2026-09-09 — TOOLING WARNING (cost real time, will bite again): do NOT use
  PowerShell `Get-Content`/`Set-Content` to rewrite the Markdown files in this
  repo. Windows PowerShell 5.1 reads a BOM-less UTF-8 file in the ANSI
  codepage, so every em dash / arrow / ≤ is destroyed on the round trip — and
  not uniformly, so a single find-and-replace does not undo it. It happened to
  TASKS.md here and was repaired by reconstructing the three damaged byte
  patterns and verifying the file's non-ASCII character set and every prose
  line against `git show HEAD:TASKS.md`. Use the Edit tool or a Node script.
- 2026-09-09 — T11 — COMPLETE. Document management and evidence custody
  (DOC01-04, DOC06; DOC05 physical register is R1, deferred). Migrations
  20260909090000_documents and 20260909090100_malformed_archive, plus
  src/lib/object-store.ts, document-intake.ts and documents.ts, five API
  routes, and the T03 object-link placeholder replaced with the real
  implementation.
  — tested via `npm run test:t11`: 110/110 pass, against the RUNNING MinIO
  container rather than in memory, because "immutable originals with a
  cryptographic hash" is a claim about storage. All four PRD evidence points:
  (1) the same filename uploaded twice yields versions 1 and 2 under DIFFERENT
  object keys, and version 1's original BYTES are read back from the store and
  compared, so nothing was overwritten; (2) a malformed archive is quarantined
  — both a missing central directory and a directory promising more entries
  than it holds — and so is a decompression bomb, caught from under 2 KB by
  reading the declared sizes without expanding anything; (3) suspending a user
  breaks their object link IMMEDIATELY while it still had 59 minutes to run,
  and empties their search results, count and suggestions, while the documents
  they filed survive; (4) the client sees the released report and neither the
  internal working paper's title nor the never-released bank statement.
  Redaction: a derivative is refused if it is byte-identical to its source, and
  cannot be released until hidden text, metadata, attachments AND the OCR layer
  are all confirmed — a partial review is still refused.
- 2026-09-09 — Two DESIGN DECISIONS in T11 worth owner awareness:
  1. End users never receive a presigned object-store URL. A presigned URL is
     a bearer credential valid until it expires regardless of what happens to
     the holder's access, which cannot satisfy DOC04's "revoke on permission
     change". Links are DocumentAccessToken rows re-authorised against live
     state (account status, membership or contact authority, release validity,
     scan verdict) on EVERY redemption, and the app streams the bytes itself.
     `presignGet` still exists in object-store.ts but is marked
     server-to-server only. This is what makes evidence point 3 true.
  2. The malware scanner is a real signature check (it detects EICAR) behind a
     `setMalwareScanner` seam, NOT a production AV engine. It fails CLOSED: an
     unreachable scanner holds the file rather than admitting it. Attaching
     ClamAV or the firm's chosen engine before go-live is outstanding and is
     recorded in SECURITY.md. In a PRODUCTION build the built-in check returns
     SCAN_UNAVAILABLE rather than CLEAN, so a deployment that forgot to attach
     an engine holds every upload instead of quietly passing it — asserted in
     the test, and the reason SECURITY.md can make that claim honestly.
- 2026-09-09 — TWO BUGS FOUND BY THE T11 TEST (both real, both fixed):
  1. The DOC06 set manifest was hashed with `JSON.stringify`, but the manifest
     is stored as jsonb, which does not preserve key order — so the hash
     verified by luck of serialisation and would have failed for reasons
     unrelated to tampering. That is worse than no check, because it teaches
     people to ignore the alarm. Now hashed canonically, fields read by name
     and joined in a fixed order (the same approach as the SEC04 audit chain).
     A regression assertion alters one recorded hash, proves the check DETECTS
     it, then restores it and proves the check is stable.
  2. IAM02's REVIEWER role had no `document.release`, yet DOC04 says in terms
     "A reviewer releases an exact version to named portal contacts." Added.
     At the same time `document.delete_approve` was split out as a separate
     senior capability — a reviewer who may send a report to a client is not
     thereby entitled to approve its destruction; an assertion covers it.
- 2026-09-09 — Regression suite: T02 13, T03 23, T04 37, T05 54, T06 44,
  T07 55, T08 55, T09 60, T10 56, T11 110 = 507 assertions, all green.
  `npm test` runs all ten. The permissions change (REVIEWER gaining
  document.release, document.delete_approve split out) was re-run against the
  full suite specifically because it touches the T04 matrix — T04 still 37/37.

- 2026-09-09 — T12.1 — Communication schema + migration
  20260909100000_communication applied, client regenerated. Purely ADDITIVE:
  the only change to an existing table is `ClientRequest.closeRule`, which has
  a default. Added COM01 MessageThread/Message/ThreadVisibilityChange (the
  visibility preview is a RECORD carrying a content digest, recomputed at
  commit, so a preview cannot wave through content nobody saw), COM02
  ClientRequestItem/ClientRequestItemResponse (a response names ONE item, so
  "one upload cannot close all requests" holds structurally), COM03
  MessageTemplate/OutboundMessage/OutboundRecipient/RecipientVerification,
  COM04 OutboundState/DeliveryAttempt/NotificationPreference. OutboundState is
  a NEW enum, not a retype of DeliveryState — ObligationAlert still uses that
  one, and retyping a live column is the destructive migration this project has
  been bitten by before. — not yet tested.
- 2026-09-09 — T12.2 — Permissions: added `message.post_internal`,
  `message.send_client`, `thread.change_visibility` and `recipient.verify` to
  the IAM02 matrix. STAFF_ARTICLE gets post_internal ONLY — an article records
  what they found but does not decide what leaves the firm under its
  letterhead, and does not verify a new external address. FINANCE can send
  (fee reminders, invoices) but holds no thread-disclosure authority.
- 2026-09-09 — T12.3-T12.6 — src/lib/communication.ts. COM01: the visibility
  preview is a stored record with a canonical content digest, recomputed from
  live messages at commit — a message added between preview and commit
  invalidates the preview instead of riding through it; the preview must be
  committed by the person who reviewed it; thread AND message visibility both
  gate what a contact reads, so publishing a thread does not declassify the
  internal notes in it. COM02: a response names ONE itemId and reminders stop
  per item, so no code path can let one upload close a sibling; ON_RECEIPT vs
  ON_ACCEPTANCE decides whether arrival or acceptance stops the reminder, and a
  REJECTED response returns the item to OUTSTANDING and RESTARTS its reminder.
  COM03: sending identity is read from the Practice row, never the caller, and
  the subject record's practice is compared with it; the confirmed preview hash
  must still match at send; unauthorised or unverified changed recipients are
  refused; attachments above NORMAL must go as portal links. COM04: a unique
  dedupKey built from event + recipient set makes "two workers, one message" a
  database constraint, and the loser of the race returns the winner's row;
  provider acceptance sets SUBMITTED and never deliveredAt; a bounce is
  terminal and marks the channel unverified; deliveryEvidence() reports
  provesReceipt/provesReading/provesFiling as false with no field that could be
  mistaken otherwise. — typechecks and lints clean; behaviour tested at T12.8.
- 2026-09-09 — T12.7 — Four API routes: threads/[threadId]/visibility (POST
  previews, PUT commits), messages/outbound/preview, messages/outbound,
  client-requests/items/[itemId]. The item route takes the item id in the PATH
  and has no body field naming a second item — the route has no vocabulary for
  fanning out, which is COM02's guarantee restated at the edge. A duplicate
  dedupKey returns 200 with `duplicate: true` rather than an error, because
  returning a failure would invite exactly the retry the key exists to stop.
  CommunicationError added to errorResponse().
- 2026-09-10 — T12 — COMPLETE. Communication and client requests (COM01-04,
  PRD §16); COM05 is R1 and COM06 is R2, both deferred.
  — tested via `npm run test:t12`: 106/106 pass. All three PRD evidence points:
  (1) two workers firing the same reminder CONCURRENTLY (both promises in
  flight before either resolves) create exactly ONE message row and one
  recipient row, both return the same id, and exactly one reports itself a
  duplicate rather than a failure — a later retry is deduplicated too;
  (2) a client corrects one item and only that item clears — the rejected
  response returns the item to OUTSTANDING and RESTARTS its reminder, the
  corrected one is accepted, and the two siblings are still OUTSTANDING with
  reminders live while the parent request reports PARTIALLY_RECEIVED with no
  receivedAt; (3) a Company invoice sent from the Associates identity is
  REFUSED, nothing is queued, the attempt is on the audit trail — and the test
  first proves the same partner really does hold send authority in Associates,
  so the refusal cannot be passing for the wrong reason, then sends the same
  invoice successfully from Company. Also covered: the visibility preview goes
  stale when a message is added after it (the thread stays INTERNAL and the
  abandoned preview records why), cannot be committed by someone who did not
  review it, and cannot be replayed; publishing a thread does NOT declassify
  the four internal notes inside it; ON_RECEIPT and ON_ACCEPTANCE requests
  behave DIFFERENTLY on identical input, proving the rule and not the upload
  decides; a body changed after confirmation is refused on the hash; the
  proposer of a new address cannot verify it; an above-NORMAL attachment must
  go as a portal link; provider acceptance never sets deliveredAt and even
  DELIVERED does not prove reading; a hard bounce is terminal, is never
  evidence of receipt, and un-verifies the channel — PASS
- 2026-09-10 — TWO TEST-QUALITY ISSUES FOUND AND FIXED DURING THE T12 RUN:
  1. A REAL GAP in the code, caught by the audit assertion: the cross-practice
     identity refusal threw before reaching the audit path, so the single most
     security-relevant refusal in the module was the one leaving no trace.
     assertSubjectBelongsToPractice() now records the Event before throwing.
  2. The quiet-hours fixture used 00:00-23:59 as "the whole day", which
     excludes 23:59 itself — so for one minute a day both the quiet-hours
     assertion AND the exemption assertion silently became no-ops. It failed
     at 23:59 IST, which is the only reason it was noticed. The window is now
     anchored on the current local minute, and the exemption assertion checks
     the exempt kind passed while the ordinary one was held IN THE SAME window
     — the same "passing the wrong way" class as the T08 note.
- 2026-09-10 — Regression suite: T02 13, T03 23, T04 37, T05 54, T06 44,
  T07 55, T08 55, T09 60, T10 56, T11 110, T12 106 = 613 assertions, all
  green. `npm test` runs all eleven.
  OPERATIONAL NOTE: running the suite with `npm run dev` ALSO up exhausted
  memory and T08 died with "timeout exceeded when trying to connect" (~1.1 GB
  free of 7 GB; the DB had only 6 connections, so this was host memory, not
  the pool). T02-T07 need the dev server; T08-T12 do not. On this machine, run
  them in two passes rather than one `npm test`.

- 2026-09-10 — T16 STARTED OUT OF ORDER at the owner's request (after T12,
  before T13-T15). Safe: the UX shell sits on modules already built and
  nothing in T13/T14/T15 is a dependency. But the acceptance test's third
  leg — INVOICE ISSUE — needs T14, which does not exist, so T16's parent box
  will stay `[~]` until T14 lands. Recorded here so it is not mistaken for an
  oversight.
- 2026-09-10 — T16.1 — Design tokens (UX01-03) in src/app/globals.css. Light
  and dark authored as two INDEPENDENT palettes, per the PRD's explicit
  warning against treating dark as an inversion. Disabled states get their own
  tokens rather than an opacity, because opacity over an inherited colour
  gives an unpredictable final ratio — and disabled is one of the two states
  the PRD names. — tested: a contrast checker recomputes WCAG ratios from the
  real token values, 27 pairings x 2 themes = 54, all passing (4.5:1 for text,
  3:1 for meaningful boundaries).
- 2026-09-10 — REAL BUG FOUND BY THAT CHECK: the focus ring scored 1.16:1
  against the primary button. Both were dark blue, so the focus indicator on
  the most important control in the app was the one you could not see —
  invisible in BOTH themes, and not something eyeballing a screenshot would
  reliably catch. Fixed with a separator ring (box-shadow filling the outline
  offset with --focus-ring-offset), so the ring is always read against a known
  colour whatever is behind the control. The assertion was NOT weakened to
  accommodate it. Separately, the disabled-border pair was dropped from the
  3:1 list because WCAG 2.2 SC 1.4.11 exempts inactive components — asserting
  a threshold the standard exempts, and then bending the design to it, would
  have been the wrong fix; disabled TEXT is still held to 4.5:1 and passes.

- 2026-09-10 — T16.2-T16.7 — The UI. Migration 20260909110000_ux_preferences
  (User.themePreference/densityPreference, both defaulted, purely additive).
  New: src/lib/ux.ts (shell context + NAV01 menu built FROM the permission
  engine, so a menu item is absent because the capability is absent),
  src/lib/screen-context.ts (every screen resolves scope in one place — a
  screen that forgets is a screen that queries unscoped), src/lib/
  client-fetch.ts, src/components/{app-shell,nav-links,states,safe-action,
  theme-switcher,density-switcher,global-search,firm-switcher}.tsx, and nine
  screens (Home, My work, Clients, Client workspace, Job detail, Review queue,
  Documents, Calendar, Practice). Theme is applied SERVER-SIDE from the saved
  preference, so there is no flash to correct and no blocking inline script.
  The T03 firm-switcher was rewritten rather than duplicated: it had never
  been wired in anywhere, and its warning named only the practice you were
  LEAVING, where UX05 requires both source and destination.
  — typecheck and lint clean; `npm run build` succeeds.
- 2026-09-10 — REAL BUG FOUND, PRE-EXISTING SINCE T06 (this one matters):
  **nothing ever issued the CSRF token.** `assertCsrf` was built in T06 and
  guards every mutating route, but no code path ever set the `bhv_csrf`
  cookie — because there was no UI to set it for. The guard was not weak, it
  was total: every mutating route in the app was unreachable from a browser,
  and it only surfaced the moment a real client tried to save a preference
  (403). Fixed in src/middleware.ts, which now mints the double-submit pair on
  the first request that lacks it (`bhv_csrf` = hash, httpOnly; a readable
  `bhv_csrf_token` = raw for the app's own script), and src/lib/
  client-fetch.ts `mutate()` is now the single client path that echoes it.
  The T16 test collects the pair the same way a browser does rather than being
  exempted from the guard — an exempted test would not have caught this.
- 2026-09-10 — SECOND BUG IN THAT FIX, worth the note: the first version of
  the middleware imported `node:crypto`, which is unavailable in the
  middleware runtime and took the WHOLE app to a 500 on every route, shell
  included. Rewritten on Web Crypto (`crypto.subtle` / `getRandomValues`).
  Lesson for anything added to middleware later: it is not a normal server
  module, and a bad import there fails everything rather than one feature.
- 2026-09-10 — NAV01 CORRECTION: managers were given the Billing pin. NAV01
  actually says "Finance can pin Billing; managers can pin Team / Reports" —
  two different sets. Corrected in ux.ts, and the test now asserts a manager
  gets Team and Reports and specifically NOT Billing.

### T16 BLOCKER — read this first next session

`tests/t16-ux.ts` has NOT been run green. It needs the dev server, and the
server on port 3000 is **PID 14164, started by a DIFFERENT Claude Code session
working in this same repo at the same time**. Next 16 refuses to start a
second dev server in one project directory, so my own attempts landed on 3001
and exited. Several minutes were spent diagnosing 500s that were the other
session's mid-edit state, not this code.

Evidence of the concurrent session: `src/lib/login-challenge.ts`,
`src/components/login-form.tsx`, `src/components/sign-out-button.tsx`,
`src/app/login/page.tsx` and new imports in `src/lib/api.ts` all appeared
during this session and were NOT written here. They were deliberately left
alone.

To finish T16 next session:
1. Confirm no other session is using this repo, or agree who owns port 3000.
2. `npm run dev` (or `npm run build && npx next start -p 3002` with
   `TEST_BASE_URL=http://localhost:3002` to avoid the dev-server conflict
   entirely).
3. `npm run test:t16`, then fix what it finds.
4. Build the dangling destinations, or drop the pins: `/team`, `/reports`,
   `/billing` (T14), `/documents/[id]`, `/obligations/[id]` are all linked
   from the menu, search results or lists and DO NOT EXIST — every one of
   them currently 404s.
5. T16.8's keyboard/200%-zoom leg still needs a real browser pass; the test
   covers the structural half only, and says so in its own header.
6. T16 stays `[~]` regardless until T14 exists — the acceptance evidence's
   third leg is "invoice issue", which cannot be exercised without it.

- 2026-09-10 — T16 BLOCKER CLEARED. Three separate faults, all real:
  1. **Build error, whole app down.** `src/lib/client-fetch.ts` (a CLIENT
     module) imported `@/lib/csrf`, which imports `next/headers` and
     `node:crypto` — so every page failed to compile. The concurrent session
     had started a `csrf-shared.ts` but never wired it up, and had given it a
     DIFFERENT raw-cookie name (`bhv_csrf_raw`) from the one middleware
     actually sets (`bhv_csrf_token`) — landing that as-is would have broken
     every mutating request instead. csrf-shared.ts is now the single source of
     the two cookie names, the header name and CsrfError; csrf.ts re-exports
     them and keeps `assertCsrf`; client-fetch.ts, middleware.ts and api.ts
     import the shared file. Middleware in particular must never reach csrf.ts
     — a bad import there fails every route, not one feature.
  2. **`localhost` in DATABASE_URL** — this is what the previous session was
     chasing as "P1017 under memory pressure". On Windows `localhost` resolves
     to `::1` first and Docker Desktop's published ports do not answer on IPv6,
     so every host-side connection hung ~30 s and then died as an opaque
     "Server has closed the connection". Proven: the identical insert took
     7 ms inside the container and 286 ms over `127.0.0.1`, against 30 s and a
     dropped socket over `localhost`. .env and .env.example now pin the IPv4
     literal, with the reason written down. The explicit pg pool config added
     earlier is still worth keeping, but it was treating a symptom.
  3. **A NAV02 assertion passing for the wrong reason** (third time this class
     has appeared — see the T08 and T12 notes). `tag()` appends the run suffix
     at the END, so `tag("Associates Only")` searched for
     "Associates Only-<run>", which matches nothing — the isolation assertion
     would have passed with isolation switched off entirely. Both searches now
     use the whole stored legal name, and a CONTROL search proves the same
     query finds the record for a manager who is entitled to it.
  — `npm run test:t16`: 72/72 pass (up from 9 tokens-only + a crash).
- 2026-09-10 — T16.7 CLOSED — the five dangling destinations are gone.
  `/team` built (live authority in the ACTIVE practice only — a membership is
  per-practice, so listing a colleague's role in the other firm from here
  would be the cross-practice disclosure T03 exists to prevent; open-work
  counts are shown but NOT linked, because /my-work has no assignee filter and
  a link would quietly show the reader's own work under someone else's name).
  `/documents/[documentId]` built (DOC02 version history is the point of the
  screen; a protected working paper is refused through PermissionState, which
  cannot name the record; no download link — DOC04 links are
  DocumentAccessToken redemptions, not URLs a page hands out).
  `/obligations/[obligationId]` built (DUE02's six dates shown separately and
  labelled, original statutory date kept on screen beside the current one so
  an extension reads as an extension; DUE04 REVIEW_REQUIRED says what is
  unknown at the top).
  `/billing` (T14) and `/reports` (T17) are NOT built, so their NAV01 pins are
  withheld: ux.ts keeps both entries with `built: false` and names the task
  that turns each on, rather than deleting the rule.
  DURABLE FIX for the whole class: tests/t16-ux.ts now walks EVERY href in the
  rendered menu and requires a 200. The three pins shipped as 404s because
  nothing checked; now something does.
- 2026-09-10 — REGRESSION CAUGHT BY THE FULL SUITE, introduced by T16:
  `/api/search` was rewritten for NAV02 and its response contract silently
  changed from `{results:[{practiceId,…}]}` to `{hits,total}`. T03's ORG
  isolation path 3 reads `results` and crashed on undefined — a shared
  endpoint's contract was changed without its other consumer being updated.
  Fixed in the ROUTE, not by repointing the test: `practiceId` is now on every
  hit (no disclosure — the hit already passed that practice's capability
  check, and the shell needs it for UX05 anyway), and `results` is returned as
  the SAME array, never a second query, because two lists that could disagree
  about what a user may see is the exact bug this endpoint exists to avoid.
- 2026-09-10 — Full regression after all of the above: T02 13, T03 23, T04 37,
  T05 54, T06 44, T07 55, T08 55, T09 60, T10 56, T11 110, T12 106, T16 73
  = 686 assertions, all green. Run in two passes on this machine (T02-T07 need
  the dev server, T08-T12 do not). NOTE: a freshly restarted dev server failed
  13 T16 assertions on first contact and passed 73/73 immediately after — the
  cold-compile flakiness already recorded here. Warm it before believing a
  failure.
- 2026-09-10 — T16.9 (part) — added `scripts/dev-totp.ts` + `npm run dev:totp`,
  which prints the current 6-digit code for the seeded dev user so the real
  /login flow can be walked in a browser without an authenticator app. It
  refuses to run under NODE_ENV=production and prints a code (one 30 s step,
  single use), never the seed.
- 2026-09-10 — Two more dev-only helpers, both refusing to run in production:
  `npm run seed:demo` (scripts/seed-demo-data.ts) puts 3 fictional clients,
  3 engagements, 5 jobs, 3 obligations and 3 documents into the seeded
  practice so the screens have content instead of nine empty states — all
  invented names on .invalid domains, identifiers left UNVERIFIED because
  format-checked is not verified (CLI02), and document versions left PENDING
  scan with a placeholder digest because a demo row must not claim CLEAN
  (DOC01 fails closed).
  `npm run dev:walk` (scripts/dev-walk-ui.ts) signs in through the REAL login
  flow — password, TOTP, session cookie, CSRF pair collected the way a browser
  collects it — then requests every destination the interface links to and
  prints the status AND the rendered <h1>, because a 200 that rendered a
  permission state is not a working screen and the status code cannot tell
  them apart. It also checks that a protected working paper is still refused.
- 2026-09-10 — HOW TO TEST THE UI BY HAND (this is the answer to "I want to
  click around"):
  ```
  docker compose up -d db redis minio
  npm run dev
  npm run seed:dev-user     # once — prints email + password + TOTP secret
  npm run seed:demo         # once — fictional content on the screens
  npm run dev:totp          # a fresh 6-digit code, valid ~30 s
  ```
  then sign in at http://localhost:3000/login with
  `dev.owner@example.invalid` / `Dev-Local-Test-Passphrase-9` and the code.
  `npm run dev:walk` proves every linked screen resolves without a browser.

- 2026-09-10 — T13.1 — schema + migration `20260910000000_client_portal`:
  `PortalInvitation`, `PortalSession`, `PortalUpload`, `PortalUploadPart`,
  `PracticeSupportContact`, enum `PortalUploadState`. Deliberately does NOT
  extend User/Session/Invitation — PRD §17 requires portal authentication to be
  separate from staff administration, so a contact is its own principal and
  authority still comes from `ContactAuthority`. Purely additive (checked: no
  DROP, no ALTER on an existing column), written idempotently, applied clean.
  `PortalUploadPart @@unique([uploadId, partNumber])` is what makes a resumed
  transfer idempotent — the same part twice updates one row.
  — migrate deploy applied; five tables verified present.

- 2026-09-10 — T13.2 — `src/lib/portal-auth.ts` + `src/lib/portal-session.ts`.
  Single-use enforced by a CONDITIONAL `updateMany` on `acceptedAt: null`, not
  by the preceding read — two simultaneous redemptions of one link must not
  both succeed. All four dead-invitation cases (unknown / expired / used /
  revoked) throw ONE error with ONE message; the distinguishing reason goes to
  the audit log, where staff can see it and a visitor cannot (POR02 "public
  self registration cannot discover existing client accounts").
  `assertPortalAccess` throws 404 and never 403, matching the staff API rule.
  Authority is re-checked on EVERY request via `liveAuthorities`, and a session
  whose grants have all been revoked is revoked server-side on next contact —
  checking only at sign-in would leave a live window after a client says
  someone has left. No dev-header bypass in the portal resolver.
  `PortalAuthError` added to `errorResponse` so the renewal instruction POR05
  requires survives to the client. — typecheck clean.

- 2026-09-10 — T13.3 — `src/lib/portal.ts`: entity switcher list, portal
  home read model, support contacts. POR01's prohibition ("do not expose
  internal staff productivity, working papers or discussion") is enforced by
  what each query SELECTS, not by filtering afterwards — an internal field
  cannot reach a portal screen unless someone adds it to a select list here
  first. The fields deliberately NOT selected are named in comments at each
  query: SLA clocks and item ownerUserId (staff productivity),
  internalTargetDate/reviewTargetDate on obligations (firm working deadlines,
  not dates agreed with the client), acceptanceStatus/confidentiality on the
  relationship (an internal judgement about the client, not theirs to read),
  issuedSnapshot on invoices. Deliverables are double-guarded: released to THIS
  contact AND not a working paper AND belonging to the entity being viewed, so
  a release for the contact's other company cannot surface. The switcher is
  built from the same liveAuthorities call that guards each request, so it can
  never offer an entity the request path would refuse. — typecheck clean.

- 2026-09-10 — T13.4 — `src/lib/portal-upload.ts` + `portalUploadPartKey` in
  object-store.ts. POR03 resumable upload built against the THREE ways a real
  client interrupts one, each with its own mechanism: (1) dropped connection →
  `PortalUploadPart @@unique([uploadId, partNumber])`, so a retried part
  updates one row; receivedBytes is RECOMPUTED from existing parts, never
  incremented, because an increment would double-count the exact retry this
  absorbs. (2) tab closed, upload id lost → `findResumable` matches on what a
  client can honestly re-declare (contact + entity + item + filename + exact
  size, plus digest when given) and hands back the upload in progress.
  (3) full re-send later → content addressing; `completePortalUpload` finds the
  digest already filed for the relationship and records
  `deduplicatedFromVersionId` instead of creating a second original.
  Completing twice returns the ORIGINAL receipt rather than filing again.
  Each part is re-verified against its recorded digest at assembly, so a
  substituted staging object cannot become a document carrying a clean hash.
  DOC01 intake is NOT bypassed — the portal runs the same assess/scan/quarantine
  path, and a refusal abandons the upload and tells the client nothing about
  our scanning. Item moves to SUBMITTED, never ACCEPTED (POR03 separates
  receipt from acceptance; COM02 close rule depends on that distinction), under
  an API02 optimistic version check so a concurrent staff decision is not
  silently overwritten.
  `fileUpload` in documents.ts extended with a portal principal:
  `actorUserId` is now `string | null` (all existing callers still typecheck)
  and `assertFilingPrincipal` requires exactly one of staff/contact with no
  default branch, so an anonymous filing has no path. `preparedByUserId` stays
  null for a portal upload — a client contact is not a preparer of the firm's
  work (DOC02). — typecheck clean.

- 2026-09-10 — T13.5 — portal API routes: `/api/portal/{home,uploads,
  uploads/[id],uploads/[id]/parts,uploads/[id]/complete,logout,
  invitations/accept,invitations/renew}`, plus the STAFF-side
  `/api/portal-invitations` (issue + revoke) kept deliberately outside the
  `/api/portal/*` prefix, so a portal cookie can never be presented to an
  invitation-issuing endpoint. Renewal returns 200 with an identical
  acknowledgement for a token that never existed — a 404 there would be the
  account-discovery oracle POR02 forbids. `?entity=` on home is a REQUEST,
  falling back to an entity the contact does hold rather than switching
  authority (same rule as NAV03 for staff deep links).
  BUG FOUND AND FIXED BEFORE TESTING: portal session cookie was scoped
  `path: "/portal"`, so it would never have been sent to `/api/portal/*` —
  every portal API call would have 401ed. A cookie carries one path prefix and
  the portal spans two, so the path is "/" and the separation from staff auth
  is carried by the cookie NAME (`bhv_portal_session` vs `bhv_session`), which
  is the part that actually does the work: neither resolver reads the other's
  cookie. — typecheck clean.

- 2026-09-10 — T13.6 — portal screens: `/portal` (home + entity switcher),
  `/portal/upload/[itemId]` (guided by service + period), `/portal/sign-in/
  [token]`, `/portal/help` (POR05 recovery + verified support route), plus a
  portal-only layout and CSS block in globals.css. NOT the staff AppShell —
  that shell IS the internal practice system POR01 says not to expose (its
  menu comes from the permission engine and its switcher spans practices).
  The sign-in page names no client, practice or contact: identity appears only
  after redemption succeeds. Redemption is a POST from the client, never work
  done during the GET render — a GET that signed you in would be triggered by
  any link preview or scanner and would burn the single use doing it.
  The renewal form asks for the dead LINK, not an email address: a link is
  enough for staff to find the contact and identifies nobody, whereas an email
  box on a public page is the account-discovery oracle POR02 forbids.
  Uploader keeps the selected file mounted on error so a retry is free, and
  resumes from the server's part list with no client-side state. Portal reuses
  the staff .card/.btn/.field/.state/.status vocabulary rather than forking it
  — same product, different audience, and one set of contrast pairs to keep
  honest. Rows stack below 600px so a status pill plus Upload button cannot
  push item text into a horizontal scroll on a phone (POR05).
  Fixed while building: ClientRequest declares `engagementId` but no
  `engagement` relation, so the service code is read in a second query (same
  as portal.ts already does). — typecheck + eslint clean.

- 2026-09-10 — T13.7 — `tests/t13-portal.ts` WRITTEN BUT NEVER RUN. Added
  `npm run test:t13` and appended it to the `npm test` chain. It covers the
  three PRD §17 evidence points plus single-use invitations, the POR01
  exposure prohibition, revocation mid-session and POR05 verified-support
  filtering, each headline paired with a CONTROL assertion (an entitled entity
  still resolves; a genuine deliverable IS shown; a genuinely different file
  IS filed as its own original) so none of them can pass with the mechanism
  switched off. Needs MinIO up — it writes real objects.

- 2026-09-10 — T13.7 — `npm run test:t13` RUN for the first time: **61
  passed, 0 failed**, covering all three PRD §17 evidence points (CFO
  switches between two approved entities and cannot see a third; expired /
  used / unknown invitations are indistinguishable and name no client;
  interrupted upload resumes leaving exactly one original). Two fixture bugs
  fixed to get there, both in the test, none in the portal code:
  `obligationRule.create` used fields that do not exist on the model
  (`formCode`/`practiceId`/`description`) — replaced with the real
  `code`/`source`/`applicability` shape as used in t09; and `governingLaw:
  "GST"` + `status: "PENDING"` were not members of `GoverningLaw` /
  `ObligationStatus` — now `CGST_ACT_2017` / `OPEN`. Note `tsc` did NOT
  catch the unknown-field case (Prisma 7's create input does not
  excess-property-check), only the two enum values; a fixture that names a
  nonexistent column still typechecks and fails at runtime.
  `pdfBytes()` passed intake unchanged — the synthetic PDF was not the
  problem it was flagged as. Also fixed the environment, not the code: the
  running `minio` container had been created without published ports
  (`9000-9001/tcp`, no host binding), so `ensureBucket` failed
  STORE_UNREACHABLE despite a healthy container —
  `docker compose up -d --force-recreate minio` republished them.
  — tested against PRD §17 acceptance evidence — PASS

- 2026-09-10 — T13.8 — Full regression, two passes on this machine as the
  memory constraint requires. Pass 1 with the dev server up: T02 13, T03 23,
  T04 37, T05 54, T06 44, T07 55 = 226. Pass 2 with it stopped: T08 55,
  T09 60, T10 56, T11 110, T12 106, T13 61 = 448. **674 assertions, 0
  failed.** T13 introduced no regression in any earlier module — notably
  T11/T12, whose document-intake and client-request paths the portal reuses
  rather than forks. — PASS

- 2026-09-10 — T13.9 — `scripts/portal-walk.ts` + `npm run portal:walk`:
  the portal twin of `dev:walk`, which could never cover /portal because it
  signs in as STAFF. Seeds a fictional CFO holding two of three entities,
  redeems a real invitation through the real POST route, then FETCHES every
  portal screen: sign-in, help (signed out and in), home, guided upload, the
  home API, and the state after logout. **23 passed, 0 failed** — every T13.6
  screen renders; none had ever been loaded before. The third entity appears
  nowhere in the rendered home HTML, the internal owner is not in the markup,
  the unverified support desk is absent from help, and portal sign-in sets
  `bhv_portal_session` without ever setting `bhv_session`. This also closes
  the "no way to click through the portal by hand" gap: the script prints a
  working single-use sign-in URL (console only, never written to a file in
  this repo). — tested against PRD §17 POR01/POR02/POR05 as rendered — PASS

- 2026-09-10 — T14.1 — schema + migration `20260910100000_billing_core`.
  T02 had already laid down InvoiceSeries/Invoice/InvoiceLine/Receipt/
  ReceiptAllocation, so T14.1 is what those were missing against FIN01/02/04:
  `FeeArrangement` + `FeeComponent` (there was no fee model at all),
  `CreditNote` + `SeriesKind` so a correction gets its own numbering,
  `Receipt.bankAccountId`, and four more `InvoiceStatus` values — FIN02
  names seven states and the enum had three.
  Additive by construction, and checked rather than assumed: no DROP COLUMN,
  no DROP TYPE, no enum recreation, no new required column on a populated
  table. The four earlier migrations here that rebuilt an enum each needed a
  hand-written USING map to avoid dropping the column; `ALTER TYPE ... ADD
  VALUE` sidesteps that whole class of damage. Counts before and after are
  equal — 131 invoices, 14 receipts, 14 allocations.
  Two deliberate compromises, both recorded because they are visible in the
  data: (1) `Receipt.bankAccountId` is NULLABLE even though FIN04 wants a
  receipt tied to the account it landed in — rows predate the column, and
  inventing an account for them would put a false fact in the register, so
  `recordReceipt()` will require one for everything created from here on;
  (2) `ReceiptAllocation.receiptId` was WIDENED to nullable so a CREDIT_NOTE
  allocation can settle an invoice with no money arriving — exactly one of
  receiptId/creditNoteId is set, enforced in the library since the DB cannot
  express it.
  Note for later: the four new InvoiceStatus values are APPENDED, so enum
  sort order is DRAFT,ISSUED,CANCELLED,APPROVED,PART_PAID,PAID,CREDITED — not
  lifecycle order. Anything that sorts by status must order explicitly rather
  than lean on the enum. Rebuilding the type to fix cosmetics is not worth the
  DROP it would require.
  — migrate deploy applied; enums, tables and row counts verified in psql

- 2026-09-10 — T14.2 — `src/lib/fees.ts` (FIN01). The requirement's own
  sentence — "never infer rates from a staff timer alone" — is enforced by
  `chargeableAmount()` having NO fallback branch: it takes units and the
  arrangement, and refuses (RATE_NOT_AGREED / RATE_NOT_APPROVED / 
  NOT_TIME_BASED) rather than reach for a default, because a plausible
  default is exactly how an unagreed rate reaches an invoice. The same guard
  `assertPricingIsAgreed` runs on create AND on revise, so "revise" cannot
  become the way to create an unpriced fee. Scope change supersedes rather
  than edits (FIN01, same rule as ENG04), under an API02 version check inside
  a transaction so a concurrent revision cannot fork the chain. Approval
  freezes `approvedSnapshot` (DAT02). Engagement is read THROUGH the practice
  scope, which is what ties a charge to the owning practice — a foreign
  engagement id is simply not found. ADVANCE is excluded from billable
  components on purpose: it is money against future work (FIN04 allocation),
  not a charge to raise. — typecheck + eslint clean, not yet executed
- 2026-09-10 — T14.3 — `src/lib/invoicing.ts` (FIN02). Numbering is an
  atomic `UPDATE "InvoiceSeries" SET nextNumber = nextNumber + 1 ...
  RETURNING`, not a read-then-write: the read-then-write version looks
  correct and silently double-issues under load. Order matters inside
  `issueInvoice` — the invoice row is CLAIMED first and the number allocated
  only after, so a losing concurrent issue does not burn a sequence number
  and leave a gap in a statutory series that somebody later has to explain.
  A draft carries sequenceNumber 0 and gets its identity at ISSUE for the
  same reason (abandoned drafts must not consume numbers).
  ISSUED is where editing stops: `assertEditable` refuses at ISSUED,
  PART_PAID, PAID, CREDITED and CANCELLED, and `issuedSnapshot` copies
  practice, client, totals and every line (DAT02) so a later rename cannot
  reach an issued invoice. Corrections go through `draftCreditNote` /
  `issueCreditNote`, which take their number from a SEPARATE CREDIT_NOTE
  series so a correction is never issued as an invoice number.
  Two review rules, deliberately different: an invoice approval defers to
  IAM04 `assertMayApprove` (which has a practice threshold below which
  self-approval is fine), but a credit note has NO threshold — it reduces
  revenue already reported, so the reviewer may never be the person who
  raised it. Revising a draft un-approves it: an approval is of particulars,
  and changed figures are not the particulars that were approved.
  PART_PAID/PAID/CREDITED are deliberately NOT set here — they are derived
  in receipts.ts (T14.4). — typecheck + eslint clean, not yet executed
- 2026-09-10 — T14.4 — `src/lib/receipts.ts` (FIN04). The evidence line
  ("cash, credited tax and balance remain distinct") is the return TYPE:
  `settlementOf()` reports cashReceived, taxDeducted, creditedByNote,
  writtenOff, refunded and balance as six separate fields, and there is
  deliberately no `totalReceived` that adds cash to TDS — a caller who wants
  one has to write the addition and own losing the distinction. The reason it
  matters: ₹90 cash + ₹10 TDS on a ₹100 invoice is not a ₹100 payment; the
  ₹10 went to the tax authority and the practice claims it back with a
  certificate, which is exactly the fact netting destroys.
  PAYMENT/ADVANCE draw down the receipt; TDS/WRITE_OFF do not, because no
  money arrived for them — that asymmetry is the requirement stated as a
  constraint rather than a label. Over-allocation is checked by re-reading
  live allocations INSIDE the write transaction; a balance computed before
  the transaction is one two concurrent allocations can both pass.
  Reversal never deletes or edits (FIN04 "preserve reconciliation
  adjustments"): the original is stamped reversedAt and a mirror row points
  at it, and since both carry reversedAt, excluding that ONE field removes
  the pair from every sum in a single condition. PART_PAID/PAID/CREDITED are
  derived in `refreshInvoiceStatus` and written nowhere else. Fully settled
  by credit note yields CREDITED, not PAID — FIN02 gives it its own state
  because it is a different fact. Receipts also require a VERIFIED bank
  account of this practice, live on the date the money arrived (ORG02).
  — typecheck + eslint clean, not yet executed
- 2026-09-10 — T14.7 — `tests/t14-billing.ts` WRITTEN AND RUN: **46 passed,
  0 failed**. Deliberately pulled forward ahead of T14.5 (routes) and T14.6
  (screens): T13 was built end to end before anything was executed, and the
  cost of that showed up here — running the test first found two real library
  defects that routes and screens would otherwise have been built on top of.
  Both PRD §25 evidence points are covered: two practices each issue number 1
  from same-named series without collision (control: the next invoice in the
  SAME series is 2, so the headline cannot pass with numbering switched off),
  and a 100000 invoice settled by 90000 cash + 10000 TDS reports cash, tax and
  balance as three separate figures (control: three allocation rows, not one
  netted).
  **Bug 1 — nested create with a composite FK.** `draftInvoice` created its
  lines nested under the invoice with an explicit practiceId. InvoiceLine
  reaches its invoice through the composite FK (invoiceId, practiceId), so
  Prisma treats practiceId as part of that relation and rejects it as a
  nested-create field. Lines are now created in a second statement inside the
  same transaction. `tsc` did not catch this — same blind spot as the T13
  fixture bug.
  **Bug 2 — a placeholder number is not "no number".** Drafts were written
  with sequenceNumber 0, and `@@unique([seriesId, sequenceNumber])` then
  permitted exactly ONE draft per series: the second concurrent draft died on
  a unique violation. Fixed in migration `20260910110000_unnumbered_drafts`
  by widening sequenceNumber to NULL on Invoice and CreditNote — Postgres
  allows many NULLs in a unique index, so unnumbered drafts coexist while two
  ISSUED documents still cannot share a number. This was a genuine design
  defect that would have limited the firm to one draft invoice at a time.
  **Bug 3 — a second author for a derived status.** Issuing a credit note
  wrote its allocation but never re-derived the invoice status, so a fully
  credited invoice sat at ISSUED. `refreshInvoiceStatus` is now exported from
  receipts.ts and called from the credit note path — exported so there is one
  WRITER of those statuses, not so there is one caller.
  Two further failures were test bugs, not library bugs, and the library was
  right both times: the stale-issue case pointed at an already-issued invoice
  (the status check refused it first, proving nothing), and a PAYMENT was
  allocated with no receipt named — which is exactly what FIN04 should refuse,
  so that refusal is now an assertion of its own.
  — tested against PRD §25 acceptance evidence — PASS

- 2026-09-10 — T14.5 — billing API routes: POST /api/invoices (draft) added
  to the existing GET, plus /api/invoices/[id] (detail + settlement),
  .../approve, .../issue, .../cancel, .../allocations, .../credit-notes,
  /api/credit-notes/[id]/issue, /api/allocations/[id]/reverse, /api/receipts
  (GET + POST) and /api/fee-arrangements (GET + POST) with .../approve.
  Every mutating route requires `expectedVersion` as a 400, not an optional
  field: API02 names approvals and allocations specifically, so a caller that
  cannot say which version it acted on has not acted on anything. The practice
  is read FROM the record and then checked, never taken from the request body
  — naming a practice you hold must not fetch a record belonging to one you do
  not. There is deliberately no DELETE on an allocation anywhere in the API;
  the correction is the reversal endpoint (FIN04). Raising a credit note and
  issuing it are two endpoints for the same reason FIN02 says "reviewed".
  FeeError/InvoiceError/ReceiptError and SeparationOfDutiesError are now mapped
  in `errorResponse` — the SoD one as 409 rather than 403, because the caller
  does hold the permission, just not on a record they authored.
  — typecheck + eslint clean, routes NOT yet exercised over HTTP

- 2026-09-10 — T14.6 — billing screens: `/billing` (register, five states,
  status filter) and `/billing/[invoiceId]` (particulars, settlement,
  allocations, reconciliation adjustments, credit notes), plus
  `src/components/invoice-actions.tsx` carrying approve / issue / cancel
  through the existing SafeAction confirm dialog. The nav has linked to
  /billing since T16 and the destination did not exist — ux.ts literally said
  "No /billing route exists yet" and pinned it `built: false`; that flag is now
  true, which closes one of the T16 dangling destinations.
  The settlement table shows cash, TDS, credited, written off and balance as
  separate ROWS. That is not layout: rolling ₹90 cash and ₹10 TDS into
  "₹100 received" would destroy on screen the same distinction FIN04 spends a
  paragraph protecting in the data. Reversed allocations get their own section
  rather than disappearing, because FIN04 says preserve them.
  The issue action passes the version the SCREEN loaded, not a re-read at click
  time — re-reading would send whatever the server currently holds and defeat
  the API02 check exactly when two people have the invoice open. A 409 is
  surfaced as a conflict and the screen reloads.
  An invoice from another practice renders as "no such invoice in this
  practice", the same answer the API gives, so the screen cannot be used to
  confirm a Company invoice exists.
  Render-checked, not assumed: `dev-walk-ui.ts` now walks /billing and an
  invoice detail, and `seed-demo-data.ts` seeds one part-paid invoice
  (88000 cash + 10000 TDS against 118000) so the detail page has something real
  to draw. Both return 200. — typecheck + eslint clean, screens RENDERED

- 2026-09-10 — T14.8 — Full regression, two passes as this machine requires.
  Pass 1, dev server up: T02 13, T03 23, T04 37, T05 54, T06 44, T07 55 = 226.
  Pass 2, dev server stopped: T08 55, T09 60, T10 56, T11 110, T12 106, T13 61,
  T14 46 = 494. **720 assertions, 0 failed.** T14 touched shared ground — it
  widened two columns, added four InvoiceStatus values and extended
  `errorResponse` — and broke nothing in T02 (data model), T03 (isolation) or
  T04 (separation of duties), the three most likely to notice.
  Note: lint had to be run as `node ./node_modules/eslint/bin/eslint.js` to be
  believed. The rtk wrapper printed "Lint: 2 errors, 2 warnings" for a run whose
  underlying eslint invocation had actually failed to start; the direct run
  scanned 9 files and found nothing. Treat a bare rtk lint summary as unverified.

- 2026-09-10 — T15.1 — Schema + migration `20260910120000_outbox`:
  `OutboxEvent` (unique actionKey, subject + subjectVersion, correlationId,
  state/attempts/maxAttempts, scheduledFor vs executedAt kept apart, claim
  columns) and `OutboxConsumerReceipt` (unique eventId+consumer). Purely
  additive — 2 tables, 1 enum, no ALTER on an existing table, so none of the
  hand-edited-migration hazards apply. `migrate deploy` applied it and
  `generate` succeeded. — not yet tested (T15.6 runs the evidence).

- 2026-09-10 — T15.2 — `src/lib/correlation.ts` (API01). One ID per request,
  carried through `AsyncLocalStorage` rather than threaded through forty
  signatures; an inbound `x-correlation-id` is honoured only if it matches a
  boring charset, since it lands in log lines and error bodies. `errorResponse`
  now funnels every branch through one `fail()` so no refusal can ship without
  a code and the ID, in the body AND the header; added `badRequest`/`notFound`
  so per-route hand-rolled 400/404 bodies stop diverging. `recordEvent`
  inherits the ID automatically. Messages were left byte-identical — only
  `code` and `correlationId` were added — so no existing assertion moves.
  — typecheck clean; behaviour tested in T15.6.

- 2026-09-10 — T15.3 — `src/lib/concurrency.ts` (API02). `updateWithVersion`
  puts the version in the WHERE so the DATABASE decides who wins — deliberately
  not read-check-write, which passes its check and clobbers anyway when another
  transaction commits in between. A zero-row result throws
  `VersionConflictError` carrying a `VersionComparison`: expected vs current
  version, the differing fields, and who moved it last (read from the audit
  trail). `merge` is offered ONLY when the two edits touched disjoint fields;
  otherwise the only honest option is reload. Wired into `errorResponse` as a
  409 with the comparison in `conflict`. — typecheck clean; tested in T15.6.

- 2026-09-10 — T15.4 — `src/lib/outbox.ts` (API03). Micro-steps 4 and 5 were
  SWAPPED (outbox before approvals) because the approval path emits an outbox
  event; writing approvals first would have left the tree unbuildable if the
  session were cut between them. `emitEvent(tx, …)` takes the transaction
  client deliberately — an event emitted on the base client commits separately,
  which is the exact bug the module exists to prevent. A duplicate `actionKey`
  returns the FIRST event rather than raising: that is what makes two clicks
  one effect. `dispatchOutbox` claims each row by conditional update, runs each
  consumer at most once ever via the unique receipt (written in the consumer
  transaction, not check-then-act), keeps `scheduledFor` and `executedAt`
  apart, backs off exponentially and ends at DEAD — a visible end state, not a
  deletion. — typecheck clean; tested in T15.6.

- 2026-09-10 — T15.5 — `src/lib/approvals.ts` (API02). Nothing in the APP
  recorded an approval before this — `Approval` rows were written directly by
  the t02/t09 test scripts, which is the gap the requirement is about. Now:
  the subject version is read `FOR UPDATE` inside the transaction (a plain read
  lets a state transition commit between check and insert), a mismatch throws
  the T15.3 comparison, IAM04 is asserted BEFORE the transaction so a refusal
  never holds a lock, a repeat click by the same reviewer on the same version
  returns the first approval rather than a second row, and the Approval + its
  outbox event commit together. `SUBJECT_TABLES` maps the five
  ApprovalSubjectType values to real tables (FILING → Job, as t09 already
  does); those names are constants, which is the only reason interpolating
  them into the lock SQL is safe. — typecheck clean; tested in T15.6.

- 2026-09-10 — T15.6 — `tests/t15-api.ts` WRITTEN AND RUN BEFORE the route
  wiring, as the T13/T14 lesson says. Both "simultaneously" clauses are real
  races through `Promise.allSettled`, not sequential calls — a sequential
  version of either passes against a read-check-write implementation. First run
  found three things:
  1. REAL DEFECT in T15.3/T15.5: the conflict comparison said "nobody changed
     it" for every filing, because the audit trail records a filing as its
     `Job` while the approval subject type is `FILING`. `versionConflict` now
     takes every name the record is known by. Fixed; evidence 1 is 11/11 green.
  2. Invoice issue commits NO outbox event — expected, that is T15.7 wiring.
  3. REAL GAP vs PRD §34: its own idempotency table says "Issue invoice …
     retry returns the same issued record", but `issueInvoice` refuses a retry
     on an ISSUED invoice with NOT_APPROVED. To fix in T15.7.

- 2026-09-10 — T15.7 — Wiring. `POST/GET /api/approvals` (the endpoint that did
  not exist); `issueInvoice` now returns the same issued record on a retry
  instead of NOT_APPROVED, which is what PRD §34's own idempotency table says;
  `issueInvoice` and `transitionJob` emit their outbox events INSIDE their
  existing transactions. Correlation ID merged into the EXISTING `src/proxy.ts`
  — I overwrote that file at first, destroying the SEC03 CSRF-pair issuer;
  recovered it with `git checkout HEAD -- src/proxy.ts` and merged instead.
  Codemod moved 58 hand-rolled `NextResponse.json({error…})` bodies in 33
  routes onto `badRequest`/`notFound`/`apiError`, so every refusal now carries
  a code and the correlation ID.
  The new route-contract scan (all 47 routes, in t15) then found a REAL
  SECURITY GAP: `/api/email-jobs` (POST) and `/api/shares` (POST, DELETE) were
  session-authenticated mutating endpoints with NO CSRF check — a cross-site
  POST would have carried the session cookie. Both now call `assertCsrf`, and
  t03 was taught to collect the double-submit pair the way a browser does
  rather than being exempted from the guard.
  Three routes are unauthenticated by design and now say so in the test with a
  reason: the two MFA-enrolment steps (mid-login, gated by the signed
  challenge) and DOC04 link redemption (the token IS the credential).

- 2026-09-10 — T15.8 — Full regression, two passes as this machine requires.
  Pass 1, dev server up (on :3001 — a stale production app container held
  :3000; it was stopped): T02 13, T03 23, T04 37, T05 54, T06 44, T07 55 = 226.
  Pass 2, dev server stopped: T08 55, T09 60, T10 56, T11 110, T12 106, T13 61,
  T14 46, T15 50 = 544. **770 assertions, 0 failed.** Lint clean (run directly
  as `node ./node_modules/eslint/bin/eslint.js src tests/t15-api.ts`): 0 errors, 3
  pre-existing warnings in untouched login/sign-out components.

- 2026-09-10 — SEC04 DEFECT found by the T15 regression and FIXED —
  migration `20260910130000_audit_chain_serialisation`. `verifyChain` failed
  at sequence 2346: two Event rows inserted 2ms apart both carried
  previousHash = row 2344's hash, because `bhv_event_hash_chain()` read "the
  highest sequence" with nothing held against a concurrent insert doing the
  same. The chain forked on its own. NOT caused by T15 — the fork is timed at
  12:49:47Z, four hours earlier, from the previous session's t14 run, which is
  the first thing in the codebase to write audit events concurrently; t06 had
  run BEFORE t14 in that session's ordering and so never saw it.
  Fix: the trigger now takes `pg_advisory_xact_lock` before reading the
  previous hash, making read-then-link atomic. The existing chain was rebuilt
  in the same migration (hash/previousHash only — no audited fact touched),
  with a note that a rebuild is the WRONG response to a chain break in
  production, where the fork is the finding. Evidence the fix holds: t12, t13,
  t14 and t15 then wrote 185 more events, many concurrently, with zero forks.

- 2026-09-10 — T16.10 — Re-ran the T16 suite against post-T15 code: 73/73,
  0 failed. T15 changed the error envelope every error state reads, added a
  correlation header to every response and put CSRF on two more routes; none of
  it moved the UX layer.

- 2026-09-10 — T16.11 — Added the INVOICE ISSUE leg of §38 to tests/t16-ux.ts,
  the one clause the file said in its own header it could not cover. A partner
  is needed (MANAGER holds invoice.draft but not approve or issue, and IAM04
  bars the drafter from approving), the detail screen is asserted to offer a
  REAL button rather than a click handler on a div, no positive tabindex
  reorders the tab sequence, both themes render the same shell controls, and
  the issue then actually completes and shows its number. 86/86 green.
  One assertion was written and deleted before it ran: its second argument was
  a STRING, so it would have passed unconditionally — the same wrong-reason
  class flagged at T08, T12 and T16.

- 2026-09-10 — T16.12 — BLOCKED, not skipped. The physical browser pass needs
  a real browser I can drive. The Claude-in-Chrome extension reports "Browser
  extension is not connected", so the keyboard / 200%-zoom / both-themes walk
  through onboarding, document review and invoice issue has NOT been done. The
  structural half is asserted in tests/t16-ux.ts (86/86) and the invoice-issue
  leg now completes end to end, but tabbing through it and reading it at 200%
  zoom is still unobserved. Unblocks by either connecting the Chrome extension
  (install + log into claude.ai + restart Chrome) or a person doing the walk
  from the sign-in steps above. T16 stays [~] until then.

### T15 — COMPLETE (2026-09-10)

All eight micro-steps done, parent box checked. Evidence exercised, not just
built: `npm run test:t15` 50/50, full regression 770/770 across two passes.

All three PRD §34 evidence lines are asserted, and both "simultaneously"
clauses run as REAL races through `Promise.allSettled` — a sequential version
of either passes against a read-check-write implementation.

Built: API01 (one correlation ID per request, minted in `proxy.ts`, forwarded
to the route, echoed on every response and inherited by every audit event; one
error envelope with a code, reached through `errorResponse`/`badRequest`/
`notFound`/`apiError`), API02 (`updateWithVersion` puts the version in the
WHERE so the database decides who wins; a conflict returns a comparison naming
both versions, the colliding fields and who moved it last; `recordApproval`
locks the subject FOR UPDATE and refuses a stale reviewer), API03 (`OutboxEvent`
written in the caller's transaction, idempotent consumers via a receipt written
in the consumer's own transaction, action keys, retries with backoff, DEAD as a
visible end state, `scheduledFor` and `executedAt` kept apart).

Real defects this task found, all fixed:
- `/api/email-jobs` and `/api/shares` were session-authenticated MUTATING
  endpoints with no CSRF check. Found by the route-contract scan, not by any
  behavioural test — nobody writes a test for the guard they forgot.
- `issueInvoice` refused a retry on an issued invoice, contradicting PRD §34's
  own line "retry returns the same issued record".
- The conflict comparison said "nobody changed it" for every filing, because
  the audit trail records a filing as its `Job`.
- SEC04: the audit hash chain forked under concurrent inserts (see the entry
  above). Pre-existing, from the previous session's t14 run.

Known limits carried forward (none block T15):
- The correlation ID is shared with library code only inside `withApiContext`;
  routes not wrapped in it still RETURN an ID (the proxy sets it) but their
  audit rows carry the ID only if the handler is wrapped. `/api/approvals` is
  wrapped; the older routes are not yet.
- `dispatchOutbox` has no runner. Nothing calls it on a schedule — events
  accumulate as PENDING until a worker or a cron is wired up (T18 territory,
  or whenever the BullMQ worker from T12 grows an outbox pass).
- API04 (versioned public APIs, service accounts, rate limits, webhook
  signatures and replay checks) is R1 and NOT built.
- The version check is now general, but only `recordApproval`, the invoice
  lifecycle and fee arrangements USE it. Deadline and allocation mutations
  still rely on their own module-level guards.

### T14 — COMPLETE (2026-09-10)

All eight micro-steps done, parent box checked. Evidence exercised, not just
built: `npm run test:t14` 46/46, full regression 720/720, both billing screens
rendered 200 through `npm run dev:walk`.

Built: FIN01 fee arrangements (agreed rates, milestones/expenses/advances,
scope-change revisions), FIN02 invoice identity (per-practice series, atomic
numbering, Draft→Approved→Issued, locked particulars, reviewed credit notes),
FIN04 receipts and allocations (bank account, part payment / TDS / write-off /
advance / refund kept distinct, over-allocation refused, reversals preserved).

Known limits carried forward (none block T14):
- FIN03 (place of supply, SAC, reverse charge, e-invoice), FIN05 (ageing,
  collections) and FIN06 (accounting bridge) are R1 and NOT built. R0 records
  the tax treatment the fee arrangement agreed; it does not compute one.
- The billing API routes are typechecked and their libraries are tested, but
  the ROUTES themselves have not been exercised over HTTP — only the two
  screens have. A t14 HTTP leg, or an extension of dev-walk, would close that.
- No screen creates a fee arrangement, drafts an invoice, or records a receipt:
  those exist as API + library only. The screens read, and issue.
- `Receipt.bankAccountId` is nullable at the database level for rows predating
  T14; new receipts always carry one.
- InvoiceStatus enum values are in insertion order, not lifecycle order —
  anything sorting by status must ORDER BY explicitly.

### T13 — COMPLETE (2026-09-10)

All nine micro-steps done and the parent box checked. Evidence actually
exercised, not merely built: `npm run test:t13` 61/61, full regression
674/674 in two passes, `npm run portal:walk` 23/23 against rendered screens.

Known limits carried forward (none of them block T13):
- `PracticeSupportContact` has no admin UI; rows must be inserted by hand or
  by `portal:walk`. POR05 needs a verified route to exist, so a real
  deployment needs this before the portal is usable.
- `scripts/seed-demo-data.ts` still creates no ContactAuthority grants and no
  PortalInvitation — `portal:walk` is now the way to get a portal login.
- No screen has been driven in a real browser (fetch-level only), so the
  client-side JS in the uploader and the entity switcher is covered by
  t13-portal at library level but not in a DOM.
- T13 deliberately does not touch POR04 (approvals) or POR06 (external
  experts) — both R1.

---

## SESSION HANDOFF (2026-09-10, end of session)

**State (updated end of the T15 session): 15 of 18 R0 tasks complete, plus
T16 substantially built.** T15 is done — the handoff text below it was written
before T15 and describes it as the next task; read the T15 section above for
what actually landed. The next unstarted task is **T17 — Reports shell
(REP01, PRD §40)**, and turning the `/reports` NAV01 pin back on in `ux.ts` is
part of it (as `/billing` was for T14). Then **T18 — Backup & recovery**, and
T16's outstanding manual browser pass.

**Superseded, kept for the detail:**
T01-T05 and T07-T14 fully done and tested. T06 is done except for an
independent penetration test, which needs an external reviewer and blocks
release per SEC01. T16 was built out of order at the owner's request and is
still `[~]` — see the T16 BLOCKER section above.

R0 remaining: **T15** (API contracts & concurrency), **T16** (finish), **T17**
(reports shell), **T18** (backup & recovery), plus T06's pen test. R1 and R2
have not been started at all.

### To resume in a fresh session

1. Read this file + SPEC.md + TASKS.md (the project-builder skill does this
   automatically). Do NOT re-read PRD.md end to end.
2. The next unstarted task in order is **T17 — Reports shell, REP01
   (PRD §40)**: filtered reports that state their refresh time, formula
   definition and record count, where an empty denominator reads
   "Not available" and never a silent zero.
   Two things that belong to T17 and are easy to miss:
   - Turn the `/reports` NAV01 pin back on in `src/lib/ux.ts` (`built: false`
     today). T14 did the same for `/billing`. The t16 test walks every href in
     the rendered menu and requires a 200, so the pin cannot be turned on
     before the screen exists.
   - T16.9's manual browser pass (keyboard only, 200% zoom, both themes) is
     still outstanding and needs a person at a browser, not a test.
   After T17: **T18 — Backup & recovery** (BCP01-04, BCP06), then R0's exit
   gate — PRD §6 plus the full §42 acceptance scenario table — before any R1
   work or `TASKS-R1.md`.
3. Bring the environment up:
   ```
   docker compose up -d db redis minio     # Postgres, Redis, MinIO
   npx prisma migrate deploy                # if any migration is pending
   npm run dev                              # only needed for T03/T06/T07
   ```
   Check MinIO actually published its ports — `docker ps` should show
   `0.0.0.0:9000->9000`, not a bare `9000/tcp`. A container created before the
   `ports:` block existed keeps running without them, and every object call
   then fails STORE_UNREACHABLE against a container reporting healthy.
   Fix: `docker compose up -d --force-recreate minio`.
   If `docker compose` cannot reach the daemon at all, Docker Desktop is not
   running — start it and wait, the containers come back by themselves.
   NOTE: the `app` container is deliberately STOPPED. It serves a stale
   PRODUCTION build on :3000, which both shadows `npm run dev` and refuses the
   `x-bhv-user-id` dev actor header the T03/T04 suites drive — so a test run
   against it fails for reasons that have nothing to do with the code. Keep it
   stopped and use `npm run dev`. If `next dev` reports "Another next dev
   server is already running" it prints the PID; `taskkill /PID <pid> /F`, or
   just point the tests at the port it names with `BASE_URL=http://localhost:<port>`.
4. Verify nothing has drifted: `npm test` (runs T02-T15, 770 assertions).
   On this memory-constrained machine run it in two passes — T02-T07 with
   `npm run dev` up, then T08-T15 with it stopped. Running all fourteen with
   the dev server live ran the host out of memory and killed T08.
   T16 (73 assertions) is NOT in `npm test` and needs the dev server; run
   `npm run test:t16` separately.

### Things that will bite you if you don't know them

- **Read a file before you overwrite it, even one you think is new.** T15
  wrote a fresh `src/proxy.ts` for the correlation ID without looking first
  and destroyed the SEC03 CSRF-pair issuer that lives there. `git checkout
  HEAD -- src/proxy.ts` recovered it. Nothing in the type system or the tests
  would have caught it until a browser could no longer POST anything.
- **A concurrency test must actually run concurrently.** Both of T15's
  "simultaneously" clauses use `Promise.allSettled` with both calls in flight.
  Written sequentially, each one passes against a read-check-write
  implementation — which is the exact bug the requirement is about.
- **A contract scan over every route finds what behavioural tests cannot.**
  The t15 scan walks all 47 `route.ts` files and asserts each authenticates,
  each mutating one calls `assertCsrf`, and none hand-rolls an error body. It
  immediately found two session-authenticated mutating endpoints with no CSRF
  check. No behavioural test would ever have caught them: nobody writes a test
  for the guard they forgot to add.
- **In a `bash -c` heredoc here, backslashes and backticks are NOT literal**
  even with a quoted delimiter. `\n` in a Python heredoc arrived as a real
  newline and every anchor match failed; backticks inside a double-quoted
  `node -e` string were executed as command substitution and silently blanked
  four spans of a PROGRESS.md entry. Use Python raw strings (`r'''...'''`) with
  single backslashes, and prefer the Edit/Write tools for anything with
  backticks in it.

- **Write the acceptance test BEFORE the routes and screens, not after.**
  T13 was built end to end and typechecked before a single line ran; T14
  reversed the order and the test immediately found three real defects
  (a nested create Prisma refuses, a unique constraint that allowed only one
  draft invoice per series, and a status never re-derived). Both tasks passed
  in the end — the difference was how much was built on top of the bug first.
- **`tsc` does not catch a Prisma `create` that names a column which does not
  exist**, nor one that omits a required field. It caught the bad enum VALUES
  in the T13 fixture and nothing else. A fixture that typechecks can still be
  fiction; only running it proves the shape.
- **Do not trust a bare rtk lint summary.** `npx eslint` printed
  "Lint: 2 errors, 2 warnings" for a run whose underlying eslint invocation had
  failed to start. `node ./node_modules/eslint/bin/eslint.js <paths>` scanned
  the same 9 files and found nothing. Same caution for any rtk-wrapped output
  that disagrees with what you expect — re-run the tool directly.

- **Restart `npm run dev` after every `prisma generate`.** Turbopack
  caches the generated client and a stale copy fails with a bare HTTP
  500. This cost time twice.
- **T03, T06 and T07 make real HTTP calls** and need the dev server.
  T02, T04, T05, T08, T09 and T10 are library-level and do not.
  **T11 needs MinIO running** (`docker compose up -d minio`) — it writes and
  reads real objects rather than faking the store.
- **Never rewrite a Markdown file in this repo through PowerShell**
  (`Get-Content` / `Set-Content`). PS 5.1 reads BOM-less UTF-8 in the ANSI
  codepage and destroys every em dash, arrow and ≤ on the round trip. Use the
  Edit tool or a Node script. This corrupted TASKS.md once; see the log entry.
- **Prisma's `migrate diff` will silently destroy data** on enum changes
  (`DROP COLUMN`) and on new required columns. Every migration here that
  touched an existing column was hand-edited to MAP or BACKFILL instead
  — see 20260909020000 (roles), 20260909030000 (session tokens),
  20260909070000 (work states), 20260909080000 (obligation statuses).
  Prisma does not wrap these files in a transaction, so a mid-file
  failure leaves partial state; the later migrations are written
  idempotently for that reason.
- **This machine is memory-constrained** (~1.2 GB free of 7 GB). A dev
  server was killed for low memory once. `src/lib/prisma.ts` now
  configures the pg pool explicitly because Prisma 7 opens parallel
  connections for nested `include`s and was intermittently failing with
  P1017 under pressure.
- Run the FULL suite after each task, not just the new one. It has
  caught a real cross-tenant bug (T10), a real destructive-approval bug
  (T07) and an over-broad assertion (T02).

### Still open / owner decisions

- Independent penetration test (blocks T06 and, per PRD SEC01, release).
- Auth.js vs. the database-backed sessions actually built — logged as a
  deliberate deviation above; needs owner acceptance.
- Hosting decision (PRD §46) still open.
- No least-privilege DB role, no key rotation for APP_ENCRYPTION_KEY, no
  dependency/secret scanning in CI — all listed in SECURITY.md.
- No malware engine attached to document intake (T11 / DOC01). Intake fails
  closed, so this blocks a usable production deployment, not just a secure
  one — see SECURITY.md "What would block release today", item 5.
- Nothing runs `dispatchOutbox` on a schedule (T15/API03). Events are written
  durably and correctly, but they accumulate as PENDING until a worker or cron
  calls the dispatcher — so no side effect actually fires yet. Needs wiring
  into the T12 BullMQ worker, or a cron, before deployment.
- Real BHV identifiers, bank accounts and signatories still to be
  confirmed at onboarding; everything built so far uses fictional data
  only.
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

## REGRESSION FLAGGED, NOT YET FIXED (2026-09-10, found by a concurrent
## session — read this before touching src/proxy.ts)

When `src/proxy.ts` was rewritten for T15.2 (API01 correlation ID), it
REPLACED the entire T06 SEC03 proxy body instead of keeping both. Checked by
grepping the whole `src/` tree: nothing sets `Content-Security-Policy`,
`X-Frame-Options`, `HSTS`, or mints the `bhv_csrf` / `bhv_csrf_token` cookie
pair anymore. Only the constants survive in csrf.ts / csrf-shared.ts — the
code that actually issued them is gone.

This is the SAME bug class T16 already found and fixed once ("nothing ever
issued the CSRF token" — see the T16 log entry above): every mutating route
becomes unreachable from a real browser, and the security headers T06's
44/44 acceptance test verified are gone from every response. If `npm run
test:t06` or the full regression suite is run right now, expect real
failures here — this is not a flaky test, the behaviour is actually missing.

Fix: merge the two responsibilities back into one `proxy.ts` — mint the
nonce/CSP/HSTS/frame headers AND the CSRF pair (T06's original body) AND set
the correlation ID header (T15.2's addition), since Next.js only runs one
proxy file. Do not just revert to the old body — the correlation-ID logic is
real, needed, already tested at the unit level, and should stay.

Not yet fixed as of this note. Whoever picks up T15.7/T15.8 or T06 next
should do this before running either suite.
