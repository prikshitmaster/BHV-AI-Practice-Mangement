---
name: spec-driven-build
description: Use this skill whenever the user wants to build a complex, multi-step software system or product from a detailed requirement document, PRD, or big idea — especially when they mention building "the fastest way," want Claude to "build step by step and test," worry about hallucination, context loss, or "junk design," or paste/upload a large spec and ask how to approach building it. Also trigger when the user asks how to structure a big project for Claude Code, wants self-testing without losing accuracy, or wants to simplify an overly complex spec before building. This skill enforces breaking large builds into a permanent SPEC file, a small numbered TASKS list with acceptance tests, and a PROGRESS log — never build a large system from one big prompt.
---

# Spec-Driven Build

Large, detailed build requests fail in predictable ways when handed to
an AI coder in one shot: hallucinated details filling gaps in an
oversized scope, "junk design" from code written before a plan was
agreed, and context loss across a long build. This skill prevents all
three by splitting every complex build into three permanent files and
a strict one-task-at-a-time loop.

## When to use this

Trigger this skill when the user:
- Uploads or pastes a PRD, spec, or detailed requirement document and
  asks how to build it, or asks Claude to just start building it
- Says things like "build it the fastest way," "build step by step and
  test," "without hallucination," "without losing accuracy," "without
  context problems," or "junk design"
- Asks how to structure a big project for Claude Code or an agentic
  coding tool
- Wants a system to test itself without losing accuracy
- Says a spec is too complex and asks to simplify it before building
- Wants to build something large in a short time (e.g. "in one night")
  without losing quality

## The three files

Always create (or update) these three files at the root of the
project, before writing any code:

1. **SPEC.md** — permanent, rarely changes. Contains: what's being
   built and why, the chosen tech stack with one-line justification
   tied to the project's actual constraints (not generic best
   practice), the build order (phases/releases), and any
   non-negotiable cross-cutting rules (e.g. security/isolation rules
   that every module must respect). If the source document already
   defines release tiers or priority levels (e.g. R0/R1/R2, P0/P1),
   preserve that structure — don't invent a new one.

2. **TASKS.md** — a numbered, sequential list of small tasks. Each task
   must be:
   - Small enough to build and verify in one sitting (a module or
     sub-feature, never "the whole system" or "the whole backend")
   - Paired with an explicit, concrete acceptance test — prefer the
     source document's own acceptance criteria/evidence if it has any;
     otherwise write one test per task yourself
   - Ordered so later tasks depend only on earlier, already-tested ones
   Group tasks into phases matching SPEC.md's build order. Never write
   a task like "implement the API" — break it down further until each
   task has a single, checkable outcome.

3. **PROGRESS.md** — a running log, updated after each task passes.
   One line per completed task: what was built, which acceptance test
   it passed, the date. Also holds a short "open questions" section for
   anything the source spec left ambiguous or explicitly deferred
   (e.g. "hosting decision not yet confirmed"). This file is what lets
   a brand-new session pick up exactly where the last one left off
   without re-reading the whole SPEC or original document.

## The build loop (apply to every task)

1. Read SPEC.md + PROGRESS.md + only the current task from TASKS.md —
   never the whole original spec document in one go.
2. Ask for (or generate, if working solo) a 3-5 line restatement of the
   plan for this task before writing any code. This is the single
   biggest lever against bad architecture — catching a wrong approach
   in 3 lines of text is cheap; catching it in 300 lines of code is not.
3. Build only that task.
4. Run the task's acceptance test. Do not proceed if it fails — diagnose
   why, don't silently retry until it happens to pass.
5. Append one line to PROGRESS.md and check the box in TASKS.md.
6. Move to the next task in a fresh context if helpful — SPEC.md +
   PROGRESS.md + the next task is enough for a new session to continue
   correctly.

Never skip step 2 or step 4 to save time. If the user is in a genuine
time crunch (e.g. "build this in one night"), the correct response is
to cut the NUMBER of tasks attempted (pick a small vertical slice, e.g.
five tasks instead of eighteen), never to cut the plan-then-test loop
itself. State explicitly which tasks/requirements are being deferred
and log them as deferred in PROGRESS.md, rather than silently dropping
them.

## Testing without losing accuracy

When the user wants the system to test itself:
- Ground truth (the correct answer for a test case) must come from the
  user or the source document — never from the same model output being
  tested. Claude can run and report on tests, but must not be the sole
  author of what "correct" means for accuracy-critical logic (financial
  calculations, data extraction, security boundaries).
- Prefer deterministic checks (exact values, fixed comparisons) over
  asking a model "does this look right?" for anything accuracy-critical.
- Keep every test case as a permanent regression suite — re-run old
  tests when adding new ones, not just the newest test.

## Simplifying an overly complex spec before building

If the user says a spec feels too complex or jargon-heavy:
- Produce a plain-language glossary mapping the document's specific
  terms to everyday meaning.
- Propose a simplified first-pass data model or scope: collapse
  enterprise-scale hieraries (e.g. tenant/org/branch/team) down to only
  the levels the user's actual current scale needs, merge tables that
  don't need to be separate yet, and reduce elaborate state machines to
  the minimum states that cover real cases.
- Explicitly call out which parts must NOT be simplified — usually
  security, data-isolation, and approval/review rules, since those are
  often the actual point of the system. Simplify structure and scope,
  never the safety-critical rules.
- Update SPEC.md and TASKS.md to reflect the simplified model as the
  new starting point, keeping the original document as an unabridged
  reference file (e.g. PRD.md) rather than deleting any detail.

## What NOT to do

- Never paste an entire large spec/PRD into one build prompt and ask
  for the whole system — this is the exact failure mode this skill
  exists to prevent.
- Never mark a task done without running its acceptance test.
- Never invent scope, fields, or business rules not present in the
  source document or explicitly requested by the user — flag missing
  information instead of guessing.
- Never silently drop or water down security, isolation, or approval
  requirements to hit a deadline; defer and log them instead.s