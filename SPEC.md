# BHV Practice Management — SPEC.md

This is the permanent reference file. Read this + the relevant PRD.md
section + the current task in TASKS.md at the start of every build
session. Do not paste the whole PRD.md into a single prompt.

Full detailed requirements (189 IDs, all acceptance evidence, all
research sources) live in `PRD.md` in this folder — that is the
converted source document, unmodified. This file is the short version:
what to build it WITH and HOW the pieces fit together.

---

## 1. Tech stack (decision)

The PRD leaves stack choice to the engineer but fixes these constraints:
firm-controlled hosting option, one relational DB, versioned object
storage, a durable background queue, local AI kept as a separate
service, exportable data, no single-engineer dependency for critical
services (DEL01).

**Chosen stack:**

| Layer | Choice | Why |
|---|---|---|
| Web app + API | Next.js (App Router), TypeScript | One codebase for UI + API routes, matches modular-monolith direction in PRD §32, and you already know this from EstatePro |
| ORM / DB access | Prisma | Typed schema = fewer accidental cross-practice queries, migrations built in (NFR03) |
| Database | PostgreSQL | Relational, supports row-level constraints for practice isolation (DAT01, ORG04) |
| Object storage | MinIO (self-hosted, S3-compatible) | Versioned, encrypted, firm-controlled per SEC02/PRV01; swap for India-region S3 later without code changes |
| Background jobs | BullMQ + Redis | Durable queue for reminders, imports, OCR, exports (WRK, DOC, COM modules) |
| Auth | Auth.js (NextAuth) + TOTP MFA | Individual accountability, MFA required for staff (AUTH01) |
| Local AI (R2 only) | Ollama or vLLM, separate container | Must not compete with DB for resources (§32); confidential inference stays local (AI02) |
| Deployment | Docker Compose, firm server + optional Cloudflare Tunnel/VPN for portal | LAN-first per §32; no public DB/Tally ports exposed |

**Explicitly not used (per PRD constraints):** No arbitrary code execution
in the automation designer (WRK06). No cloud AI by default (AI02). No
vendor lock-in storage format — every export must be plain files (BCP05).

This stack is R0-first: everything above is needed even for the secure
core. R1 (audit/tax/GST packs) and R2 (AI, connectors) build on top
without changing this foundation.

---

## 2. Release order (from PRD §6 and §47 traceability index)

Build strictly in this order. Do not start a later release until the
current one's acceptance evidence passes.

1. **R0 — Secure core** (97 requirements): practice isolation, roles/auth,
   clients, engagements, work/tasks, deadlines, documents, portal,
   billing register, data model, security, backups, UX shell.
2. **R1 — Practice depth** (77 requirements): audit workpapers, tax/GST/
   corporate packs, notices/certificates, advanced billing, time/capacity,
   knowledge base.
3. **R2 — Controlled expansion** (15 requirements): AI assistance,
   connectors (Tally, GST portal, WhatsApp), enterprise identity.

## 3. R0 module build order

Within R0, build in this order — later modules depend on earlier ones:

1. Data model + practice isolation (§33 DAT01-03, §7 ORG01-06)
2. Auth + roles (§8 IAM01-06, §10 AUTH01-05)
3. Security baseline + audit trail (§35 SEC01-06)
4. Client registry (§11 CLI01-06)
5. Engagements (§12 ENG01-06)
6. Work/tasks/queues (§13 WRK01-06)
7. Deadlines (§14 DUE01-06)
8. Documents (§15 DOC01-06)
9. Communication (§16 COM01-04, defer COM05/06 to R1/R2)
10. Client portal (§17 POR01-05, defer POR06 to R1)
11. Billing register (§25 FIN01, FIN02, FIN04 — defer FIN03/05/06 to R1)
12. API contracts + concurrency (§34 API01-03)
13. Reports shell (§40 REP01)
14. Navigation + UX states (§38-39 UX01-05, NAV01-04)
15. Backups + recovery (§37 BCP01-04, BCP06)

Each module's full rule text and acceptance evidence is in `PRD.md` —
open only that section when building that module.

## 4. Non-negotiable cross-cutting rules (apply to every module)

- **Deny by default, server-side** (IAM01) — every module's queries must
  filter by practice/tenant scope at the query layer, not the UI.
- **No silent last-write-wins** on approvals, deadlines, allocations, or
  signed material (API02) — use optimistic version checks everywhere.
- **Historical snapshots are immutable** (DAT02) — issued invoices, filed
  forms, signed reports never change after issue.
- **Five UI states per screen**: normal, empty, loading, error,
  permission/conflict (NAV03).
- **AI (when built in R2) never has final authority** — it drafts,
  a human approves (AI04).

## 5. Related build: BHV AI Spend Tracker

A separate, much smaller tool (Google Sheets + Apps Script) for tracking
the firm's own AI/software subscription spend — referenced in PRD §27
OPS02 as a pattern to incorporate, but built and delivered independently.
See `spend-tracker-brief.md` in this folder for its own spec and
generation prompt. Do not merge its data model into the main practice
management database — it tracks the firm's internal spending, not client
work.
