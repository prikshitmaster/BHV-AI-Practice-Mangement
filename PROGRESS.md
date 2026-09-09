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

---

## SESSION HANDOFF (2026-09-09)

**State: 12 of 18 R0 tasks complete, plus T16 substantially built.**
T01-T05 and T07-T12 fully done. T06 is done except for an independent
penetration test, which needs an external reviewer. T16 was built out of
order at the owner's request and is `[~]` — see the T16 BLOCKER section
above, which is the first thing to read next session.

### To resume in a fresh session

1. Read this file + SPEC.md + TASKS.md (the project-builder skill does
   this automatically).
2. **First, deal with the T16 blocker above** — a concurrent session was
   editing this repo and owns the dev server; `tests/t16-ux.ts` has never
   been run green, and several menu destinations 404.
3. Then the next unstarted task in order is **T13 — Client portal,
   POR01-03, POR05 (PRD §17)**; POR04 (approvals) and POR06 (external
   experts) are R1. T14 and T15 follow, and T14 is what finally unblocks
   T16's third acceptance leg.
3. Bring the environment up:
   ```
   docker compose up -d db redis minio     # Postgres, Redis, MinIO
   npx prisma migrate deploy                # if any migration is pending
   npm run dev                              # only needed for T03/T06/T07
   ```
4. Verify nothing has drifted: `npm test` (runs T02-T12, 613 assertions).
   On this memory-constrained machine run it in two passes — T02-T07 with
   `npm run dev` up, then T08-T12 with it stopped. Running all eleven with
   the dev server live ran the host out of memory and killed T08.

### Things that will bite you if you don't know them

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
