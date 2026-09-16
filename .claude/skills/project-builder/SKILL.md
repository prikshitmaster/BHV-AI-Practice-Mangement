---
name: project-builder
description: Use when building, resuming, or continuing implementation of the BHV Practice Management project in this directory (or picking a new task from TASKS.md) — loads only the relevant PRD.md section, restates a short plan, implements the next task, verifies it against its acceptance evidence, and updates PROGRESS.md/TASKS.md. Trigger on requests like "build the next task", "continue the project", "do T0X", "what's next", or "resume work".
---

# Project Builder — BHV Practice Management

This project is spec-driven. Do not re-read the whole `PRD.md` (3000+ lines) every
time — follow this loop instead.

## Session start

1. Read `PROGRESS.md` in full (log + open questions).
2. Read `SPEC.md` in full (tech stack, release order, module build order, the
   non-negotiable cross-cutting rules in section 4).
3. Read `TASKS.md` and find the **first task whose checkbox is `[ ]` or `[~]`**
   (top to bottom — tasks are ordered by dependency, don't skip ahead).

## Micro-stepping (resume across sessions with limited budget)

The user runs sessions with a set turn/token limit and wants to be able
to close a session mid-task and resume in a brand-new one with minimal
re-derivation and minimal hallucination risk. To support that, every
task in TASKS.md must be broken into **micro-steps** the moment work on
it starts — small enough that a fresh session can read just
PROGRESS.md's last log line + the task's remaining unchecked
micro-steps and know exactly what to do next, with no guessing.

- When you begin a task (step 6 below), immediately expand its single
  checkbox into a nested list of micro-step checkboxes right under it
  in TASKS.md, e.g.:
  ```
  - [~] **T01 — Project scaffold.** ...
    - [x] Scaffold Next.js + TypeScript app
    - [ ] Add Prisma with placeholder schema + first migration
    - [ ] Add docker-compose.yml (app, db, redis, minio)
    - [ ] Add /api/health route
    - [ ] Run acceptance test: docker compose up + migration + health 200
  ```
- Each micro-step should be completable and independently verifiable in
  a few tool calls — not "build Prisma layer," but "add schema.prisma
  with X models" / "run first migration" / "verify migration applied."
- After finishing a micro-step, immediately check its box AND append a
  one-line entry to PROGRESS.md's Log (same format, but per micro-step,
  e.g. `T01.2 — added docker-compose.yml — not yet tested`). Do this
  before moving to the next micro-step, not batched at the end — a
  session can be cut off between any two micro-steps.
- A new session resumes by reading PROGRESS.md's last line, finding
  that task in TASKS.md, and starting at the first unchecked
  micro-step under it — never by re-reading prior chat history.
- Only check the parent task's own box `[x]` once every micro-step is
  done AND the task's full acceptance test (quoted in TASKS.md) passes.

## Per task

4. Each task cites a PRD.md section (e.g. "Implement DAT01-03 (PRD §33)").
   Open **only that section** of `PRD.md` — use Grep for the requirement ID
   prefix (e.g. `DAT0`) or the `PRODUCT REQUIREMENTS / NN` page markers to
   jump straight there instead of reading the file linearly.
5. Restate the plan in 3-5 lines: what you're building, which requirement
   IDs it satisfies, and what the acceptance test will check. Get this in
   front of the user before writing code on anything nontrivial.
6. Mark the task `[~]` in TASKS.md while in progress.
7. Build it. Apply the cross-cutting rules from SPEC.md §4 unconditionally:
   - Every query/mutation filters by practice scope server-side (deny by
     default) — never rely on the UI to hide cross-practice data.
   - No silent last-write-wins on approvals, deadlines, allocations, or
     signed material — use optimistic version checks.
   - Historical snapshots (issued invoices, filed forms, signed reports)
     are immutable after issue.
   - Every screen implements five states: normal, empty, loading, error,
     permission/conflict.
   - AI features (R2 only) never get final authority — draft only, human
     approves.
8. Run the exact acceptance test quoted in the task's `*Test: ...*` line.
   Don't check the box on a passing build alone — the acceptance evidence
   must actually be exercised.
9. On pass:
   - Check the box `[x]` in TASKS.md.
   - Append one line to `PROGRESS.md`'s Log section:
     `YYYY-MM-DD — T## — <what was built> — tested against <which
     acceptance evidence> — PASS`
   - Keep the entry short — it's a log, not a report.
10. On failure or block: log it in `PROGRESS.md` anyway, with the reason.
    Don't leave it silently unchecked with no explanation.

## Release boundaries

- Stay inside the current release (R0 first, per TASKS.md). Don't build R1/R2
  items a task explicitly defers, even if related code is nearby.
- Before starting R1: re-read PRD §6 exit gate ("Cross practice isolation,
  restore drill and realistic client workflow pass") and run the full §42
  acceptance scenario table. Then create `TASKS-R1.md` following TASKS.md's
  pattern, sourced from PRD §18-24, §26-28 and the R1 rows of §47-49.

## Hard constraints (apply always, not just at T05/T06)

- No real client data, real BHV identifiers (names, FRNs, GSTINs, PANs, bank
  accounts), production credentials, or live AI/email/filing integrations
  without explicit owner approval — see PROGRESS.md's open questions.
- No secrets, passwords, or recovery codes in any file in this repo.
- Don't invent a hosting decision (firm-controlled vs. India-region cloud) —
  it's an open decision per PRD §46.

## Note on spend-tracker-brief.md

That file specs a separate, smaller deliverable (Google Sheets/Apps Script
AI spend tracker) — unrelated to the main app's data model and not part of
the TASKS.md sequence. Only touch it if the user explicitly asks for that
tool.
