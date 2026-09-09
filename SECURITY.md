# SECURITY.md — control mapping and evidence

Covers SEC01-06 (PRD §35) for the R0 secure core.

**This is a self-assessment, not a certification.** PRD SEC01 is explicit:
"Record applicable controls and evidence; do not claim certification from
adopting the checklist." Nothing below should be read as an ASVS
attestation. Controls are mapped to OWASP ASVS 5.0 **Level 2 as a target**,
and every row states what evidence exists *today*.

Status key: **Implemented** (built and covered by an automated test) ·
**Partial** (built, gaps named) · **Operational** (a deployment/process
step, not code) · **Not started**.

---

## SEC01 — Verification baseline

| Area | Status | Evidence |
|---|---|---|
| Access control (ASVS V4) | Implemented | `src/lib/practice-scope.ts`, `src/lib/permissions.ts`; tests T03 (23 assertions), T04 (37) |
| Authentication (V2) | Implemented | `src/lib/auth.ts`; test T05 (54 assertions) |
| Session management (V3) | Implemented | DB-backed sessions, 30 min idle / 12 hr absolute, immediate revocation; T05 |
| Cryptography (V6) | Implemented | `src/lib/crypto.ts` — scrypt N=2¹⁶, AES-256-GCM, RFC 6238 TOTP, constant-time comparison |
| Error handling & logging (V7) | Implemented | `src/lib/audit.ts`, append-only trigger, hash chain |
| Data protection (V8) | Partial | Encryption at rest for MFA seeds; **full-disk/tablespace encryption is an operational step** |
| Communications (V9) | Operational | TLS terminates at the reverse proxy; not configured in this repo |
| Malicious code / dependencies (V10) | Partial | `npm audit` clean at time of writing; **no automated scanning in CI yet** |
| Business logic (V11) | Implemented | Separation of duties, optimistic version checks; T04 |
| Files & resources (V12) | Not started | Upload scanning is **T11** |
| API & web service (V13) | Implemented | Server-side authorisation on every route; T03 |
| Configuration (V14) | Partial | Security headers in `src/middleware.ts`; **no secret scanning in CI yet** |

### Known gaps

- **No independent penetration test has been performed.** PRD SEC01's
  acceptance evidence requires "independent authorisation and penetration
  testing before production", and fundamental isolation failures block
  release outright. This cannot be satisfied from inside the project and is
  an open blocker in `PROGRESS.md`.
- No dependency or secret scanning in CI.
- CSP still allows `'unsafe-inline'` for styles (Tailwind runtime injection);
  to be tightened in T16.
- **No production anti-virus engine is attached to document intake (T11,
  DOC01).** `src/lib/document-intake.ts` ships a real signature check — it
  detects the EICAR test file, and the acceptance test proves the intake path
  refuses a detected file — but it is not a malware engine. ClamAV (or the
  firm's chosen scanner) must be attached through `setMalwareScanner()` before
  go-live. The default behaviour is correct in the meantime: the scanner
  **fails closed**, and in a PRODUCTION build the built-in check returns
  `SCAN_UNAVAILABLE` rather than `CLEAN`, so a deployment with no engine
  attached holds every upload instead of quietly passing it (asserted in
  `tests/t11-documents.ts`). Type validation, size limits,
  decompression-ratio limits, malformed-archive detection and
  encrypted-archive refusal are all independent of the engine and are already
  in force.

---

## SEC02 — Encryption and keys

| Control | Status | Notes |
|---|---|---|
| TLS on network paths | Operational | Terminate at the reverse proxy. HSTS is emitted only in production (`src/middleware.ts`) so a LAN HTTP deployment is not bricked. |
| MFA seed encryption | Implemented | AES-256-GCM, key from `APP_ENCRYPTION_KEY`, **held outside the database**. The app refuses to start rather than fall back to a default key. |
| Password storage | Implemented | scrypt, per-user salt. Plaintext never persisted. |
| Token storage | Implemented | Session, invitation, recovery and backup codes stored as SHA-256 digests only. |
| Database / object / backup encryption | Operational | Volume-level encryption is a deployment decision, tied to the open hosting question in PRD §46. |
| Key rotation | **Not started** | Rotating `APP_ENCRYPTION_KEY` currently requires re-enrolling MFA. A re-encryption routine is needed before production. |

> Encryption does not replace access control, and does not protect data from
> an authorised administrator. The practice-isolation controls under SEC01 are
> what stop cross-practice disclosure — not encryption.

---

## SEC03 — Application hardening

| Threat | Control | Evidence |
|---|---|---|
| SQL injection | Parameterised queries throughout Prisma; no string-built SQL in application code | `src/lib/**` |
| XSS | React escaping by default; CSP without `script-src 'unsafe-inline'`; nonce per request | `src/middleware.ts` |
| CSRF | SameSite=Lax cookie **plus** origin check **plus** double-submit token | `src/lib/csrf.ts` |
| Clickjacking | `X-Frame-Options: DENY`, `frame-ancestors 'none'` | `src/middleware.ts` |
| MIME sniffing | `X-Content-Type-Options: nosniff` | `src/middleware.ts` |
| Path traversal / insecure object access | Object links are authorised server-side before any storage URL exists; keys are namespaced per practice | `src/app/api/documents/[versionId]/link/route.ts` |
| Information disclosure | A forbidden practice returns **404, not 403**, so a refusal cannot confirm a record exists | T03 test |
| Public debug endpoints | None. The dev actor-header bypass is blocked in production by `assertNoDevAuthInProduction()` | T05 test |
| SSRF | No user-supplied URL is fetched anywhere yet | — |
| Unsafe deserialisation | No `eval`; JSON parsing only. WRK06 automation designer explicitly forbids arbitrary code execution | SPEC.md §1 |

---

## SEC04 — Audit trail

| Requirement | Status | Evidence |
|---|---|---|
| Capture actor, practice, action, record id, exact version, time, result, reason | Implemented | `Event` model; `recordEvent()` in `src/lib/audit.ts` |
| Append-only for the application identity | Implemented | Postgres triggers `event_no_update` / `event_no_delete` reject UPDATE and DELETE — verified to fire even for the table owner |
| Integrity check | Implemented | SHA-256 hash chain computed **inside the insert trigger**, so the application cannot forge it. `verifyAuditChain()` walks and validates it. |
| No passwords or document bodies in logs | Implemented | `sanitiseMeta()` redacts secret-looking keys and truncates oversized strings; T05 searches a real `pg_dump` for the actual secrets used |
| Independently protected copies | **Operational** | Shipping audit events to separate append-only storage is a deployment step; ties into T18 backups. |

> A superuser can still disable triggers. The application should therefore
> connect as a **non-superuser role** in production — see SEC06.

---

## SEC05 — Monitoring and incidents

Implemented in `src/lib/monitoring.ts`, writing `SecurityAlert` rows.

| Signal | Threshold | Severity |
|---|---|---|
| Failed logins | 5 in 15 min | WARNING |
| Repeated cross-scope access attempts | 3 in 15 min | **CRITICAL** |
| Privilege changes | any | INFO |
| Queue failures | any | WARNING |
| Abnormal export volume | >5,000 rows | WARNING |

Incident owner and destination come from `SECURITY_INCIDENT_OWNER` and
`SECURITY_ALERT_DESTINATION`. If unset, alerts are still recorded and
visibly marked `UNASSIGNED` / `UNCONFIGURED` rather than silently dropped.

**Alerts carry counts, ids and timestamps only** — never document contents
or secret values — so routing them to a chat channel cannot itself become a
confidentiality breach. The evidence stays in the append-only trail.

Still needed: storage-capacity and backup-failure probes (T18), and actual
delivery to the destination (T12 messaging).

---

## SEC06 — Developer and vendor access

| Requirement | Status | Notes |
|---|---|---|
| Synthetic data in development and QA | Implemented | Every test fixture is fictional; no real names, FRNs, GSTINs, PANs or bank accounts. `PROGRESS.md` carries this as a hard constraint. |
| No production database copies on personal devices | **Operational** | Policy, not enforceable in code. Must be in the engagement terms. |
| Least-privilege database role | **Not started** | The app currently connects as the owning role in development. Production should use a role with `INSERT/SELECT/UPDATE/DELETE` on data tables but **no ability to disable triggers**, so SEC04's append-only guarantee holds against the application identity. Migrations run separately as the owner. |
| Time-limited, ticketed production access | **Operational** | Not yet defined. |
| Subprocessor register | **Not started** | — |

---

## What would block release today

1. **No independent penetration test.** SEC01 acceptance evidence, and a hard
   release gate in the PRD.
2. **No least-privilege DB role**, so SEC04's append-only guarantee is weaker
   in practice than it looks on paper.
3. **No key rotation routine** for `APP_ENCRYPTION_KEY`.
4. **Hosting decision still open** (PRD §46) — encryption at rest and TLS
   termination cannot be finalised until it is settled.
5. **No malware engine attached to document intake** (T11 / DOC01). The intake
   path is complete and fails closed, but until a real scanner is wired in,
   every upload is held as unscanned in a production configuration — which is
   safe, and also unusable. This must be settled before go-live, not after.
