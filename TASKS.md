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

- [x] **T04 — Roles & permissions.** Implement IAM01-06 (PRD §8): deny-
  by-default server-side checks, role definitions, assignment scope,
  separation of duties, lifecycle (invite/suspend/revoke).
  *Test: a manager assigned to both firms sees only authorised teams; an
  article cannot approve their own filing; revocation invalidates active
  sessions and queued exports.*
  - [x] T04.1 — Schema: IAM02 role set (Group Owner, Practice Partner,
    Manager, Reviewer, Staff/Article, Finance, HR, IT Admin, Quality
    Reviewer, Client Contact) via a mapped enum migration; IAM03
    `assignmentScope` + `PermissionGrant` for restricted areas (HR,
    credentials, fee rates, protected workpapers); IAM04
    `SelfReviewException`; IAM05 `Session` + `QueuedJob` so revocation
    has something to invalidate.
  - [x] T04.2 — `src/lib/permissions.ts`: deny-by-default action matrix
    keyed on role + assignment scope + record sensitivity. IT control
    is separated from professional data authority (IAM02).
  - [x] T04.3 — IAM04 separation of duties: the author of a filing or
    invoice cannot approve it; sole-reviewer situations require a
    disclosed self-review exception with reason + quality-review
    follow-up.
  - [x] T04.4 — IAM05 lifecycle: invite → accept → suspend/revoke.
    Revocation invalidates active sessions AND cancels queued exports
    before further disclosure.
  - [x] T04.5 — IAM01: background workers re-check membership at
    execution time, not just at enqueue time.
  - [x] T04.6 — Acceptance test script covering all four evidence
    points.
  - [x] T04.7 — Run the acceptance test, all assertions pass.

- [x] **T05 — Authentication.** Implement AUTH01-05 (PRD §10): MFA login,
  session/recovery rules (30 min idle / 12 hr max), invitation bootstrap,
  DSC custody register (metadata only, no private keys).
  *Test: reset/MFA recovery works with the owner absent via a documented
  substitute process; no plaintext secrets in logs or backups.*
  AUTH04 (portal secret vault) is R1; AUTH06 (SSO) is R2 — both deferred.
  - [x] T05.1 — Schema: `UserCredential`, `MfaEnrolment` (secret stored
    encrypted, never plaintext), `MfaRecoveryCode` (hashed),
    `Invitation` (single-use, hashed token, 48 h default),
    `RecoveryRequest` (AUTH02 substitute-approver flow),
    `DscCustodyRecord` (AUTH05 metadata ONLY), `RateLimitCounter`.
    Extend `Session` with a hashed token + step-up fields.
  - [x] T05.2 — `src/lib/crypto.ts`: scrypt password hashing, AES-256-GCM
    secret encryption keyed from env, RFC 6238 TOTP with replay
    prevention, single-use token generation/hashing.
  - [x] T05.3 — `src/lib/auth.ts`: login → MFA challenge → session.
    Server-enforced 30 min idle / 12 hr absolute expiry, immediate
    revocation, rate limiting on login and invitations.
  - [x] T05.4 — AUTH02 step-up authentication for exports, role changes
    and secret reveal.
  - [x] T05.5 — AUTH03 invitation bootstrap: single-use expiring setup,
    and joining a known email domain must NOT enrol a user in both
    practices.
  - [x] T05.6 — AUTH05 DSC custody register + AUTH01 guard that a
    default/demo admin account can never be deployed to production.
  - [x] T05.7 — Acceptance test: MFA recovery with the owner absent via
    a documented substitute approver; recovery cannot silently remove
    MFA; no plaintext secrets anywhere in the DB or logs; no
    "admin/admin".
  - [x] T05.8 — Run the acceptance test + full regression suite.

- [~] **T06 — Security baseline.** Implement SEC01-06 (PRD §35): OWASP
  ASVS-aligned hardening, encryption at rest/in transit, audit trail
  (append-only), monitoring hooks, no public debug endpoints.
  *Test: audit trail captures actor/practice/action/version/time/reason
  for every sensitive change; independent pen-test finds no critical/high
  unresolved.*
  NOTE: the second half of that test — an INDEPENDENT penetration test —
  cannot be performed from inside this project. It needs an external
  reviewer and is tracked as an open blocker in PROGRESS.md. T06 is only
  closed for the parts that can be evidenced here.
  - [x] T06.1 — SEC04 append-only audit trail enforced by the DATABASE:
    triggers reject UPDATE and DELETE on `Event`, plus a tamper-evident
    hash chain computed in-trigger so the application cannot forge it.
  - [x] T06.2 — SEC04 completeness: one audit helper capturing actor,
    practice, action, record id, exact version, time, result and reason;
    assert no passwords or document bodies are ever written to it.
  - [x] T06.3 — SEC03 hardening: security headers (CSP, HSTS,
    X-Content-Type-Options, frame denial, referrer policy), CSRF
    double-submit protection, and no debug endpoints in production.
  - [x] T06.4 — SEC05 monitoring: `SecurityAlert` records for failed
    logins, abnormal exports, privilege changes and repeated
    cross-scope attempts, with an incident owner and alert destination —
    and without copying confidential file contents into the alert.
  - [x] T06.5 — SEC01/SEC02/SEC06 documented control mapping in
    `SECURITY.md`: ASVS L2 controls with evidence pointers, key
    handling/rotation, least-privilege DB role and dev-data rules.
    Records what is NOT yet verified rather than overclaiming.
  - [x] T06.6 — Acceptance test for the evidenceable half.
  - [x] T06.7 — Run acceptance test + full regression suite.

## Phase 2 — Client & engagement core

- [x] **T07 — Client registry.** Implement CLI01-06 (PRD §11): Party/
  ClientRelationship/Contact model, duplicate resolution, guided intake,
  acceptance/conflict check, Client 360 screen.
  *Test: onboard a fictional company with two GST registrations and
  engagements in both practices; reject an unauthorised email change;
  no cross-practice data leaks via autocomplete.*
  CLI05 (continuance/changes) is R1 — deferred.
  - [x] T07.1 — Schema: `VerificationStatus`/`FieldSource` on identifiers
    and contact channels (CLI03 — imported values stay UNVERIFIED),
    `PartyGroupLink` (CLI01 group links), `ContactChangeRequest`
    (authority-gated field changes), `AcceptanceCheck` (CLI04),
    `IntakeDraft` (CLI03 incomplete drafts).
  - [x] T07.2 — `src/lib/client-registry.ts`: CLI02 duplicate detection
    that is NON-REVEALING across practices — staff learn a match exists
    without learning whose client it is.
  - [x] T07.3 — CLI03 guided intake: only the fields the selected
    service needs, resumable drafts, verification status + source
    recorded per critical field.
  - [x] T07.4 — CLI04 acceptance & conflict check gating activation,
    screening both practices without disclosing restricted detail.
  - [x] T07.5 — Contact change authority: an unauthorised email change
    is REJECTED and the source evidence retained.
  - [x] T07.6 — API routes + CLI06 Client 360 screen with
    permission-aware tabs, practices visibly separated.
  - [x] T07.7 — Acceptance test: fictional company, two GST
    registrations, director contact, engagements in BOTH practices;
    unauthorised email change rejected; autocomplete and duplicate
    detection leak nothing.
  - [x] T07.8 — Run acceptance test + full regression suite.

- [x] **T08 — Engagements.** Implement ENG01-06 (PRD §12): service
  catalogue templates, engagement record, letter generation, change
  control, closure/termination.
  *Test: change an accepted annual retainer to add litigation work — the
  original scope stays intact, a new fee/authority review appears,
  existing GST jobs are not recreated.*
  ENG05 (full independence linkage across services) is R1. The
  independence BLOCK named in the acceptance evidence is built here,
  since it gates activation; the assessment behind it comes in R1.
  - [x] T08.1 — Schema: `ServiceTemplate` (ENG01 versioned, with
    checklist/steps/gates/fee model), ENG02 fields on `Engagement`
    (scope, exclusions, fee basis, billing entity, planned dates,
    retainer vs ad hoc, revision links), `EngagementLetter` (ENG03),
    `EngagementChange` (ENG04), `EngagementBlock`.
  - [x] T08.2 — ENG01 service catalogue + creating an engagement from a
    pinned template version.
  - [x] T08.3 — ENG03 letter generation from verified facts, review
    routing, and typed consent / electronic acceptance / signature kept
    as DISTINCT record types.
  - [x] T08.4 — ENG04 change control: a post-acceptance scope, fee,
    period or practice change creates a revision preserving the
    original; practice reassignment additionally demands documented
    client arrangements and new authority.
  - [x] T08.5 — Activation gating: unresolved blocks prevent activation,
    and an independence block is resolvable only by an ELIGIBLE reviewer
    who is not the engagement owner.
  - [x] T08.6 — ENG06 closure: distinguish completion / withdrawal /
    cancellation / non-applicability; outstanding fees and retained
    documents stay traceable after closure.
  - [x] T08.7 — Acceptance test: annual retainer + litigation change;
    original scope intact; fee AND authority review raised; existing GST
    jobs NOT recreated; independence block prevents activation.
  - [x] T08.8 — Run acceptance test + full regression suite.

## Phase 3 — Work & deadlines

- [x] **T09 — Work model & queues.** Implement WRK01-05 (PRD §13):
  Engagement/Job/Task/ChecklistItem/ClientRequest, state machine,
  recurrence with dedup key, dependencies/blocking, saved queues.
  Defer WRK06 (automation designer) to R1.
  *Test: run the monthly job generator twice — only one job exists per
  key; reopening a completed job doesn't alter its filing evidence.*
  - [x] T09.1 — Schema: the full WRK02 `WorkState` set via a mapped enum
    migration, `WorkStateTransition` (so reopening preserves completion
    history), `ClientRequest`, `TimeEntry`, `WorkReassignment`, plus
    WRK01 fields on Job/Task (priority, estimate, tags, required role on
    checklist items, not-applicable reason).
  - [x] T09.2 — WRK02 state machine with legal transitions enforced
    server-side, and every transition recorded with actor and reason.
  - [x] T09.3 — WRK03 recurrence: dedup key is practice + client
    relationship + stable template/obligation identity + period. The
    template VERSION is snapshot metadata and must NOT be part of the
    dedup identity — otherwise editing a template silently duplicates
    every open job. Bulk preview before creation.
  - [x] T09.4 — WRK04 dependencies and blocking: a task blocks on a
    missing predecessor or evidence; a client delay pauses the internal
    SLA clock ONLY, never the statutory deadline, and escalation
    continues regardless.
  - [x] T09.5 — WRK05 saved queues (My work, Team work, Review queue,
    Waiting for client, Overdue) and reassignment carrying reason,
    active timers and pending approvals; employee exit produces a
    handover list rather than orphaned jobs.
  - [x] T09.6 — Acceptance test: generator run twice yields ONE job per
    key; requesting changes after review invalidates the prior approval;
    reopening a completed job preserves its filing evidence and
    completion history.
  - [x] T09.7 — Run acceptance test + full regression suite.

- [x] **T10 — Statutory calendar.** Implement DUE01-04, DUE06 (PRD §14):
  obligation rules, deadline instances, extensions with preview, alerts
  requiring acknowledgement evidence. Defer DUE05 (regulatory update
  inbox, AI-assisted) to R2.
  *Test: an extension applicable to one taxpayer class changes only
  matching open obligations; an obligation with unknown category stays
  in "Review required".*
  NOTE: TASKS.md defers DUE05 to R2, but PRD §14 marks it **R1**. The
  PRD is authoritative; either way it is not built in R0.
  - [x] T10.1 — Schema DUE01: full `ObligationRule` (jurisdiction,
    governing law, service, taxpayer category, applicability, period,
    form version, due-date expression, authoritative source + date,
    effective interval, approving CA) with Draft/Reviewed/Active/
    Superseded/Retired lifecycle.
  - [x] T10.2 — Schema DUE02: the five distinct dates per instance
    (original statutory, current statutory, internal prep target,
    review target, client cutoff, payment deadline) and — per the PRD's
    closing note — **law, assessment year and tax year stored
    INDEPENDENTLY**, so the filing date alone never selects the Act.
  - [x] T10.3 — DUE04 status set (Due soon, Overdue, Waiting, Submitted
    awaiting acknowledgement, Filed, Rejected, Not applicable) via a
    mapped enum migration, keeping Review required for unknown
    applicability.
  - [x] T10.4 — DUE03 extensions: an approved notification PREVIEWS
    affected open instances, applies only to matching category/period/
    jurisdiction, preserves old values with the source, and never
    reopens completed filings.
  - [x] T10.5 — DUE04 alerts and filing evidence: escalation by interval
    and responsible role; filing requires an acknowledgement reference
    AND reviewer confirmation; a BOUNCED reminder is never evidence of
    client receipt.
  - [x] T10.6 — DUE06 calendar behaviour: India defaults, date-only
    statutory obligations, holidays may move internal reminders but
    never statutory dates, and a missed scheduler run produces catch-up
    alerts without duplicates.
  - [x] T10.7 — Acceptance test: an extension for ONE taxpayer class
    changes only those open obligations, the audit trail shows BOTH
    dates, an unknown category stays in Review required, and a bounced
    reminder is not receipt.
  - [x] T10.8 — Run acceptance test + full regression suite.

## Phase 4 — Documents & communication

- [x] **T11 — Document management.** Implement DOC01-04, DOC06 (PRD §15):
  intake with malware/MIME scanning, immutable versioned originals,
  classification, release/sharing with expiring links, retention/lock.
  Defer DOC05 (physical register) to R1.
  *Test: upload the same filename twice — both versions preserved;
  revoke a user — their signed object link and search results stop
  working immediately.*
  Full PRD evidence also requires: quarantine a malformed archive, and a
  client can see the released report but cannot discover internal
  working paper titles. Plus the section's closing rule — redaction
  produces a DERIVATIVE with a review record; black rectangles alone are
  not proof.
  - [x] T11.1 — Schema + migration `20260909090000_documents`: DOC01
    intake provenance (filename, declared vs detected MIME, size,
    received time, checklist link, quarantine state + rejection reason),
    DOC02 immutability guard fields (approvedAt on a version, supersede
    links), DOC03 `documentType`/period/entity/sensitivity +
    `DocumentClassification` draft metadata with correction history,
    DOC04 `DocumentKind` (INTERNAL / CLIENT_SUPPLIED / DELIVERABLE) +
    `DocumentRelease` + `DocumentAccessToken`, DOC06 `DocumentSet`
    manifest + `RetentionPolicy` + `DeletionRequest`.
  - [x] T11.2 — `src/lib/object-store.ts`: MinIO-backed content-addressed
    storage over hand-rolled SigV4 (no new dependency). Object keys are
    prefixed with the practice `documentNamespace` (ORG04). Records WHY
    a raw presigned URL is never handed to an end user.
  - [x] T11.3 — `src/lib/document-intake.ts` (DOC01): magic-byte MIME
    detection compared against the declared type, size cap,
    decompression-ratio/zip-bomb limit, pluggable malware scanner,
    quarantine + actionable rejection reason. Nothing reaches the store
    until it passes.
  - [x] T11.4 — `src/lib/documents.ts` (DOC02): same filename creates
    version n+1; an APPROVED original can never be overwritten by an
    edit, OCR, conversion or integration retry — those produce
    derivatives. Preparer / reviewer / status per version.
  - [x] T11.5 — DOC03 classification + search: results, counts, snippets
    and suggestions all pass the practice scope + field permission check
    BEFORE anything is returned. OCR/AI classifications are DRAFT with a
    source reference and correction history.
  - [x] T11.6 — DOC04 release: a reviewer releases an EXACT version to
    named portal contacts; links expire, re-authorise at redemption and
    die on permission change; internal working papers are never
    automatically deliverable. Redaction produces a derivative with a
    review record.
  - [x] T11.7 — DOC06 lock & retention: finalise a set through a manifest
    of versions + hashes; retention schedule and legal hold by record
    class; deletion requires eligibility check + approval + logged
    action, and backups keep their own expiry.
  - [x] T11.8 — API routes (upload, versions, search, release, link
    redeem) and replace the T03 placeholder in
    `api/documents/[versionId]/link` with the real implementation.
  - [x] T11.9 — Acceptance test `tests/t11-documents.ts` covering all
    four PRD evidence points + redaction.
  - [x] T11.10 — Run the acceptance test + full regression suite.

- [x] **T12 — Communication core.** Implement COM01-04 (PRD §16):
  unified context, structured client requests, outbound safeguards
  (recipient verification), reminder engine with duplicate keys.
  Defer COM05/06 to R1/R2.
  *Test: trigger the same reminder through two workers — only one
  logical message sends; a staff member switching practice cannot send
  a Company invoice from an Associates identity.*
  - [x] T12.1 — Schema + migration `20260909100000_communication`:
    COM01 MessageThread / Message / ThreadVisibilityChange; COM02
    ClientRequestItem / ClientRequestItemResponse + closeRule on
    ClientRequest; COM03 MessageTemplate / OutboundMessage /
    OutboundRecipient / RecipientVerification; COM04 OutboundState enum,
    DeliveryAttempt, NotificationPreference. Purely additive, written
    idempotently.
  - [x] T12.2 — Permissions: add `message.post_internal`,
    `message.send_client`, `thread.change_visibility` to the IAM02 matrix.
  - [x] T12.3 — `src/lib/communication.ts` COM01: threads, messages,
    preview-gated visibility change (digest must match at commit).
  - [x] T12.4 — COM02: itemised requests, per-item responses, close rule
    (received vs accepted), reminder suppression per item only.
  - [x] T12.5 — COM03: outbound preview + send safeguards (practice
    identity binding, recipient authority, changed-recipient
    verification, portal link over attachment, template rendering).
  - [x] T12.6 — COM04: reminder engine — dedup key, quiet hours, digest,
    retry limits, bounce handling, six separate delivery states.
  - [x] T12.7 — API routes for threads, client requests and outbound send.
  - [x] T12.8 — Acceptance test `tests/t12-communication.ts` covering the
    three PRD evidence points + the safeguards.
  - [x] T12.9 — Run the acceptance test + full regression suite.

- [x] **T13 — Client portal.** Implement POR01-03, POR05 (PRD §17):
  portal home, contact authority with entity switcher, guided upload.
  Defer POR04 (approvals) and POR06 (external experts) to R1.
  *Test: a group CFO switches between two approved client entities and
  cannot see a third; interrupted upload resumes without duplicate
  originals.*
  - [x] T13.1 — Schema + migration: `PortalInvitation` (single use,
    expiring, scoped to contact + practice), `PortalSession` (token hash
    only, keyed on Contact NOT User — PRD §17 "separate portal
    authentication from internal staff administration"), `PortalUpload`
    (resumable: expected size + sha256, received bytes, parts).
  - [x] T13.2 — `src/lib/portal-auth.ts`: issue/accept invitation, portal
    session create + validate, `requirePortalContact()`. An unknown,
    expired or already-used token returns ONE identical safe response
    that never names a client (POR02 + acceptance evidence).
  - [x] T13.3 — `src/lib/portal.ts`: authorised-entity list from live
    `ContactAuthority`, and `loadPortalHome()` built on an explicit field
    allowlist so working papers, internal threads and staff productivity
    cannot cross (POR01).
  - [x] T13.4 — Resumable upload (POR03): begin/append/complete keyed so a
    resumed transfer reuses the same record and the same content-addressed
    object key, producing no duplicate original. Receipt confirms intake
    only, never correctness.
  - [x] T13.5 — Portal API routes under `/api/portal/*`, all scoped to the
    session contact's live authority for the named relationship.
  - [x] T13.6 — Portal screens: home + entity switcher, guided upload,
    invitation accept, expired-link recovery, support contact from
    owner-configured firm details. Mobile responsive (POR05).
  - [x] T13.7 — Acceptance test `tests/t13-portal.ts` covering the three
    PRD evidence points + the isolation safeguards.
  - [x] T13.8 — Run the acceptance test + full regression suite.
  - [x] T13.9 — Render pass: seed a portal contact + invitation and load
    every portal screen over HTTP (`npm run portal:walk`). The T13.6
    screens have never been rendered; a screen that 404s or throws on
    render would pass every library-level test above.

## Phase 5 — Billing register (R0 subset)

- [x] **T14 — Fees & invoicing (core).** Implement FIN01, FIN02, FIN04
  (PRD §25): fee arrangements tied to engagement/practice, invoice
  identity with locked series, receipts/allocations. Defer FIN03
  (tax particulars), FIN05 (collections), FIN06 (accounting bridge) to R1.
  *Test: create identical invoice sequence numbers in separate practice
  series without collision; allocate a part payment and TDS deduction
  distinctly.*
  - [x] T14.1 — Schema + migration. `FeeArrangement` (+ components for
    milestones/expenses/advances, and a scope-change revision chain);
    extend `InvoiceStatus` from 3 states to the 7 FIN02 names via a
    HAND-WRITTEN additive `ALTER TYPE` (Prisma's diff drops columns on
    enum changes — see the four migrations already hand-edited for this);
    `CreditNote` + its own series; `bankAccountId` on `Receipt`;
    `REFUND` on `AllocationKind`.
  - [x] T14.2 — `src/lib/fees.ts` (FIN01): fee arrangements tied to
    engagement + owning practice, agreed tax treatment/currency/effective
    rate/approval stored, scope change as a revision that preserves the
    original. A rate must be agreed, never inferred from a timer.
  - [x] T14.3 — `src/lib/invoicing.ts` (FIN02): series numbering that
    cannot collide across practices and cannot double-issue under
    concurrency; Draft → Approved → Issued lifecycle; issued particulars
    locked in `issuedSnapshot`; corrections only via credit note.
  - [x] T14.4 — `src/lib/receipts.ts` (FIN04): receipt against the correct
    practice bank account; part payment, TDS, advance, write-off and
    refund as distinct allocations; over-allocation refused; Part paid /
    Paid / Credited derived from allocations, never typed by hand.
  - [x] T14.5 — API routes for fee arrangements, invoices (draft/approve/
    issue/cancel/credit) and receipts/allocations.
  - [x] T14.6 — Screens: invoice list, invoice detail with issue action,
    receipt allocation. This is what unblocks T16's third acceptance leg
    ("invoice issue using only the keyboard"). Render-checked via
    `npm run dev:walk`, which now covers both.
  - [x] T14.7 — Acceptance test `tests/t14-billing.ts` covering both PRD
    evidence points + the safeguards, each with a control. RUN EARLY, ahead
    of T14.5/T14.6, so routes and screens are not built on unverified logic
    — it found two real defects in the libraries and one in the schema.
  - [x] T14.8 — Run the acceptance test + full regression suite.

## Phase 6 — Platform correctness

- [x] **T15 — API contracts & concurrency.** Implement API01-03 (PRD §34):
  server-side auth on every endpoint, optimistic version checks, outbox-
  pattern event reliability.
  *Test: two reviewers approve different versions simultaneously — only
  the current version can be approved; two invoice-issue clicks create
  one invoice.*
  - [x] T15.1 — Schema + migration `outbox`. `OutboxEvent` (actionKey unique,
    payload, subject + subjectVersion, correlationId, state, attempts,
    scheduledFor, executedAt, lastError) and `OutboxConsumerReceipt`
    (unique on eventId+consumer) so a consumer that runs twice acts once.
    Purely additive — no existing column touched.
  - [x] T15.2 — `src/lib/correlation.ts` + `errorResponse` upgrade (API01):
    one correlation ID per request, echoed on every response and error and
    carried into `recordEvent`; every error body is `{error, code,
    correlationId}` with a safe human message.
  - [x] T15.3 — `src/lib/concurrency.ts` (API02): `VersionConflictError`
    carrying a comparison (expected vs current version, what changed, who
    changed it, when) and `updateWithVersion` — a conditional update whose
    zero-row result is a conflict, never a silent overwrite.
  - [x] T15.5 — `src/lib/approvals.ts` (API02): the approval path that does
    not exist yet — approvals are currently only created by tests. Records
    a decision against an EXACT subject version, refuses a stale version
    with a comparison, and enforces the T04 separation-of-duties check.
  - [x] T15.4 — `src/lib/outbox.ts` (API03): `emitEvent(tx, …)` writes in the
    caller's transaction; `dispatchOutbox` runs consumers idempotently, keeps
    action key / attempts / scheduledFor / executedAt, and isolates failure so
    a dead external side effect never rolls the business change back.
  - [x] T15.6 — Acceptance test `tests/t15-api.ts`. WRITTEN AND RUN BEFORE the
    route wiring in T15.7, per the T13/T14 lesson: three PRD §34 evidence
    lines plus controls for each safeguard.
  - [x] T15.7 — Wire the routes: `expectedVersion` on the mutating endpoints,
    a POST /api/approvals endpoint, outbox emission on job transition and
    invoice issue, correlation ID middleware across all 46 routes, and an
    API01 contract assertion that every route authenticates.
  - [x] T15.8 — Run the acceptance test + full regression suite.

- [~] **T16 — Navigation & UX states.** Implement UX01-05, NAV01-04
  (PRD §38-39): light/dark themes, five states per screen, accessible
  identity cues, safe action confirmation.
  *Test: complete client onboarding, document review, and invoice issue
  using only the keyboard, in both themes.*
  NOTE: built out of order at the owner's request, after T12. This is
  safe — the UX shell sits on top of modules already built and nothing
  in T13/T14/T15 is a dependency of it. But the acceptance test's third
  leg, INVOICE ISSUE, needs T14 (FIN01/FIN02/FIN04), which does not
  exist yet. The parent box therefore stays `[~]` until T14 lands and
  that leg is exercised.
  - [x] T16.1 — Design tokens + theme (UX01-03): light/dark/system
    palettes defined as token pairs (not an inversion), 16px body / 14px
    tables, 44px targets, visible focus, print style.
  - [x] T16.2 — Theme preference saved per user + a switch that
    preserves scroll, draft and selected record. Migration
    20260909110000_ux_preferences (User.themePreference/densityPreference,
    both defaulted, purely additive).
  - [x] T16.3 — Five-state primitives (NAV03) in `src/components/states.tsx`.
  - [x] T16.4 — App shell + NAV01 menu + UX05 identity cues, including
    the cross-practice warning that names BOTH source and destination.
  - [x] T16.5 — NAV02: permission-aware global search (`/api/search`),
    breadcrumbs, Back destination, recents scoped per practice in
    sessionStorage.
  - [x] T16.6 — NAV04 safe actions in `src/components/safe-action.tsx`.
  - [x] T16.7 — Screens: Home, My work, Clients, Client workspace, Job
    detail, Review queue, Documents, Calendar, Practice, plus Team,
    Document detail and Obligation detail. No dangling destinations remain:
    `/team`, `/documents/[documentId]` and `/obligations/[obligationId]`
    are built; `/billing` (T14) and `/reports` (T17) do not exist, so
    their NAV01 pins are withheld — ux.ts keeps both entries with
    `built: false` and names the task that turns each on. TURN THE PIN
    BACK ON as part of T14 and T17. The t16 test now walks every href in
    the rendered menu and requires a 200, so this cannot recur silently.
  - [x] T16.8 — `tests/t16-ux.ts`: 28 token pairings x 2 themes recomputed
    from globals.css, plus NAV01/02/03/04, UX01/03/05 and the two §39
    evidence points asserted against real rendered HTML over HTTP.
    RUN GREEN: 72/72. Three real faults fixed on the way (client bundle
    importing `next/headers` via csrf.ts, `localhost`/IPv6 in DATABASE_URL,
    and a NAV02 assertion that passed for the wrong reason) — see
    PROGRESS.md.
  - [~] T16.9 — Full regression suite run: T02 13, T03 23, T04 37, T05 54,
    T06 44, T07 55, T08 55, T09 60, T10 56, T11 110, T12 106, T16 73
    = 686 assertions, all green. Caught and fixed a real regression T16
    had introduced in the `/api/search` contract that T03 depends on.
    OUTSTANDING: the manual browser pass (keyboard only, 200% zoom, both
    themes) — the structural half is asserted in t16-ux.ts, the physical
    half still needs a person at a browser. See PROGRESS.md for the
    sign-in steps and `npm run dev:walk`.

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

