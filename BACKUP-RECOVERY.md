# BACKUP-RECOVERY.md — backup, restore, continuity and drills

PRD §37: BCP01 (backup scope), BCP02 (recovery targets), BCP03 (restore
controls), BCP04 (operational continuity), BCP06 (exercises and ownership).
BCP05 (export and vendor exit) is R1 and not covered here.

> "Recovery must restore useful, correctly scoped records, not merely a
> database file." — PRD §37

This document names locations, owners and procedures, and ends with a list of
what is **not yet verified**. Read that list before relying on any of it. The
code is the authority for behaviour: `src/lib/backup.ts`, `restore.ts`,
`continuity.ts`, `drills.ts`; acceptance evidence is `npm run test:t18`.

---

## 1. What a backup contains (BCP01)

Each run writes one directory, `<BACKUP_ROOT>/<backupRunId>/`, and copies it
whole to `<BACKUP_OFFSITE_ROOT>/<backupRunId>/`.

| Artifact | Contents | Notes |
|---|---|---|
| `database-rows.ndjson` | every row of every table in `public` | table list read from `information_schema`, rows serialised by Postgres (`to_jsonb`) so numerics, timestamps, enums and jsonb round-trip exactly |
| `audit-events.ndjson` | the SEC04 audit trail, again, with the hash-chain head | a separately controlled copy, so the trail can be proven unaltered without restoring the database |
| `object-manifest.json` + `objects/<sha256>` | every document version's hash and object key, plus the bytes | missing objects are reported as gaps, never skipped silently |
| `configuration.json` | non-secret configuration | every secret-shaped value replaced with "set — value withheld"; credentials stripped from URLs |
| `templates.ndjson` | service templates, message templates, letterheads | |
| `key-inventory.json` | which keys a restore needs, and their fingerprints | **no key material** — see §4 |
| `manifest.json` (plaintext) | the artifact list and hashes | its own SHA-256 is recorded on the BackupRun, so a dropped artifact is detectable |

Every artifact except `manifest.json` is AES-256-GCM encrypted under
`BACKUP_ENCRYPTION_KEY`, which the engine **refuses** to accept if it equals
`APP_ENCRYPTION_KEY`: whoever can read the running application's secrets must
not thereby be able to read every historical copy (BCP01 "separate access
controls"). A wrong key is refused outright — GCM authenticates — so a
corrupted or substituted archive cannot pass as a good one.

## 2. Approved locations

**No production location is approved.** The hosting decision
(firm-controlled server vs. approved India-region cloud) is open under PRD
§46, and backup locations follow from it. Until the owner decides, the values
below are development settings only.

| Setting | Development value | Production requirement |
|---|---|---|
| `BACKUP_ROOT` (primary copy) | `./.backups` | a volume the application host can write, not the database volume |
| `BACKUP_OFFSITE_ROOT` (separate failure domain) | `./.backups-offsite` — **same disk, not a separate failure domain** | a different machine, site or provider; unset = recorded as a gap on every run |
| Immutable / offline copy | none (`--immutable` only sets a read-only bit) | object-lock / WORM storage or rotated offline media |
| `RESTORE_TARGET_DATABASE_URL` | `bhv_restore_drill` on the **same** Postgres server | an isolated host with no route to email, portal or filing endpoints |

The owner records the approved values here, with the date and approver, when
the hosting decision is made.

## 3. Administrators and custodians

Named people are recorded at onboarding, not in this repository (no real
identifiers in the repo — see PROGRESS.md open questions). The roles are:

- **System administrators** — the `IT_ADMIN` role; the only role with
  `system.administer`. They take backups, run drills, release outbound holds
  and report service status. **At least two**, or the sole-administrator drill
  fails by design.
- **Key custodians** — at least two named people who each hold the escrowed
  keys (§4) and who are not all system administrators. Fewer than two is
  recorded as a drill exception.
- **Replacement authority** — a partner (`user.grant_access`) able to appoint a
  new administrator and to approve an AUTH02 recovery as substitute when the
  administrator is absent.

## 4. Key escrow

The archive holds a key **inventory**, never keys: a backup that contains the
key that decrypts it protects nothing.

1. `BACKUP_ENCRYPTION_KEY` and `APP_ENCRYPTION_KEY` are each written down (or
   exported to sealed offline media) at generation and held by two custodians
   in separate places.
2. Each escrow record carries the key's **fingerprint** — the first 16 hex
   characters of its SHA-256, the value shown in `key-inventory.json` and on
   drill results. A custodian can confirm they hold the right key without
   anyone reading it aloud.
3. In the `KEY_SERVICE_UNAVAILABLE` drill, a custodian retrieves the escrowed
   backup key and enters its fingerprint. The drill compares it with the key
   the backups were actually written under; a mismatch is a **missing item**,
   not a pass on say-so.
4. `APP_ENCRYPTION_KEY` matters for recovery too: MFA seeds in a restored copy
   are wrapped in it. The key drill fails if the app key in use differs from the
   one recorded in the newest backup's inventory.

## 5. Procedures

### 5.1 Taking a backup

- **Scheduled:** `npm run backup` from cron / Task Scheduler. The PRD target
  is RPO ≤ 1 hour, so it must run **at least hourly** (see §7 — nothing
  schedules it yet). Exit code is 0 on a completed run; gaps are printed and
  should alert whoever owns the schedule.
- **On demand:** "Take a backup now" on `/continuity` (system administrators).
- Add `--immutable` only when the offsite root genuinely is write-once or
  offline storage. The run records the claim.

### 5.2 Restoring (BCP03)

1. Stop the application, or make sure the restore target is not the database it
   uses. The engine refuses a target equal to `DATABASE_URL`.
2. Set `EXTERNAL_SENDING_DISABLED=1` **yourself**. The engine refuses to start
   without it and the CLI will not set it for you — outbound must be paused
   before the restore, not after.
3. `npm run restore -- latest --offsite` (or a specific `backupRunId`; omit
   `--offsite` to use the primary copy). Use `--offsite` whenever the primary
   server is suspect.
4. Read the reconciliation. Every check must pass: object references both ways,
   a random sample of file hashes, receipt and allocation totals in paise, no
   over-allocated receipt, active obligations, the audit-chain head, and the
   outbound hold. Revocations, suspensions, revoked sessions/links/enrolments,
   cancelled exports, legal holds and executed erasures made **after** the
   backup are re-applied from the live database.
5. Every queued outbound message and outbox event is parked in
   `HELD_RESTORE_RECONCILIATION`. Nothing is sent.
6. A system administrator releases the hold on `/continuity` with a reason. The
   release is refused on any failed or absent check and on a stale version;
   there is deliberately no override.

### 5.3 Offline revocation ledger

Step 4's re-application reads post-backup decisions from the **live**
database. In a real disaster that database may be gone, and the check then
**fails** (the hold stays on) rather than passing quietly. Until a better
source exists:

- Between backups, record every suspension, access revocation, legal hold and
  approved erasure in a ledger kept **outside** this system (dated, with who
  and what).
- After a restore in which the live side was unreachable, apply each ledger
  entry through the normal screens on the restored system, then have a second
  administrator confirm it before the hold is released.

This procedure is manual and has **not been rehearsed** (§7).

### 5.4 During an outage (BCP04)

- `/continuity` shows every service's state to every member. Database, object
  store and queue are **measured**; internet, email, AI and connectors are
  **reported** by an administrator. A status not re-checked for 15 minutes shows
  as unknown, and each state says what still works.
- **Emergency obligation export:** a partner or manager exports the open
  obligations of one practice as plain CSV — every statutory and internal date
  in its own column. It needs `export.run`, a fresh authenticator code and a
  reason, is narrowed to the exporter's assignment scope, and is logged with
  the row count and SHA-256 (never the contents). Take one when an outage is
  foreseeable; it needs the database, so it cannot be taken after it has gone.
  Handle the file as confidential client data.
- **Downtime sheet:** work done on paper is entered on `/continuity` when the
  core returns, dated when it was actually done. Each line stays outstanding
  until someone records where it went. Entering or reconciling a line never
  creates time entries or completes jobs — do those through the normal screens.

### 5.5 Drills (BCP06)

Run from `/continuity` → "Run a drill". Each drill performs real checks and
records its own missing items and exceptions; people add the remediation
owner, a due date and notes but cannot remove a finding. The next drill is
due one quarter later.

| Scenario | What it actually does |
|---|---|
| Primary server loss | decrypts and hash-checks every artifact in the **offsite** copy, then restores **from the offsite copy** and records achieved RPO / RTO |
| Key service unavailable | held key opens the newest backup; a wrong key is refused; archived secrets' app key matches the one in use; backups under keys no longer held are counted; escrow retrieval checked against the real fingerprint |
| Sole administrator departed | who else holds system administration, who can appoint a replacement, which key custodians remain, which DSC tokens are in the leaver's custody — within the firm's own tenant |
| Scheduled quarterly | the primary-loss restore on the normal cadence |

**Before production** the drill gate on `/continuity` must read "passed": each
of the three named scenarios' **latest** drill clean or its remediation
closed, and the latest primary-loss drill a fully reconciled restore that met
both targets. Closing a remediation note cannot satisfy the last condition —
only a successful re-drill can.

## 6. Measured so far (development data only)

| Run | Data | RPO | RTO |
|---|---|---|---|
| T18.4 restore | 12,456 rows / 104 tables | 612 s | 20 s |
| T18.6 primary-loss drill (offsite) | 12,520 rows / 103 tables | 3 s | 13 s |
| CLI restore, offsite, 2026-09-11 | 13,364 rows / 103 tables | 51 s | 13 s |

These are dev-sized. They say the mechanism works, not that production meets
the 1 h / 8 h targets.

## 7. What is NOT yet verified

1. **Nothing schedules backups.** RPO ≤ 1 h holds only if something runs
   `npm run backup` at least hourly. `/continuity` warns when the newest backup
   is past target, but no scheduler exists.
2. **The offsite copy is on the same disk in development** — it is not a
   separate failure domain. Production locations await the PRD §46 decision.
3. **No immutable storage.** `--immutable` sets a read-only bit, which is not
   WORM and does not survive a compromised administrator.
4. **The restore target shares the Postgres server** in development, so
   "isolated" is enforced by configuration checks, not by network isolation.
5. **Post-backup re-application depends on the live database.** The offline
   revocation ledger (§5.3) is manual and unrehearsed.
6. **Key escrow is attested, not observed.** The system checks the fingerprint
   a custodian enters; it cannot see where the key is kept. Neither key has a
   rotation routine (also listed in SECURITY.md).
7. **RTO is measured to "the restored core answers a query"**, on ~13k rows. It
   does not include rebuilding the host, redeploying the app, DNS, or users
   re-establishing sessions, and production volume is unmeasured.
8. **Backup-failure alerts are recorded, not delivered.** A failed run raises a
   SecurityAlert row; nothing sends it to a person.
9. **Internet, email, AI and connector status is manual.** No integration
   exists to measure them in R0.
10. **A primary-loss drill run from the web runs a full restore inside one HTTP
    request** (300 s limit). At production volume, restore from the CLI.
11. **One unexplained failure** was seen once in the T18 test: the
    re-application step threw with an empty error message, the check failed and
    the hold correctly stayed on; the next runs passed. The error is now
    reported in full if it recurs.
12. **Development data gaps.** Backups of the dev database report ~120 document
    versions whose objects were never stored — rows inserted by earlier test
    suites without uploading bytes. Production versions are created only through
    intake, which stores the object first; this is reported, not hidden.
13. **No independent review.** Like the rest of R0 (see SECURITY.md), none of
    this has been examined by an external reviewer.
