---
name: session-work-split
description: Splits remaining project work across multiple active Claude Code sessions/agents so tasks finish faster in parallel, without creating bugs from conflicting or out-of-order edits. Use whenever the user says things like "split this across my other sessions", "use my other active sessions", "have the other agents pick this up", "work on this faster / in parallel", or mentions running multiple Claude Code sessions on the same project and wanting them to divide up the remaining tasks. Always checks which sessions are actually free (not busy), checks the project's task list for what's left, and only assigns tasks to different sessions when they're truly independent (no shared files, no sequencing dependency) — because two sessions editing the same working tree at the same time is the single most common way a "go faster" request quietly introduces a bug.
---

# Session Work Split

Splitting work across sessions only saves time if the split doesn't create new
problems. The failure mode isn't rare: two sessions editing the same git
working tree at the same time will happily stomp each other's uncommitted
changes, or one session's half-finished edit gets picked up mid-flight by
another. "Complete faster, don't create bugs" is the actual spec — treat both
halves as hard requirements, not just the first one.

## Step 1 — See what's actually available

Call `ListAgents`. It reports each peer session's status. Read it literally:

- `busy` — currently executing something. **Not available**, even if the
  task sounds small. You don't know what it's mid-edit on.
- `idle` — finished its last task, free to take new work.
- `offline` (Remote Control) — not reachable right now; don't plan around it.
- `bg` / cloud sessions — check status the same way; `busy` still means busy.

Only `idle` sessions (or a fresh subagent/session you spawn yourself) are
real candidates for new work. If the user explicitly says to interrupt a busy
session anyway, that's their call — but don't do it on your own judgment,
since you can't see what state it would abandon mid-task.

## Step 2 — Find what's actually left to do

Look for the project's own task list before inventing one: `TASKS.md`,
`TODO.md`, an issue tracker, a PRD's task breakdown, or whatever the repo
already uses (check recent commit messages for a task-ID convention like
`T21`, `T22` — that usually points at a tracked list). Read the remaining
items, not just their titles — a one-line task name can hide a dependency on
the item before it.

## Step 3 — Sort tasks into "safe to parallelize" and "not"

For each pair of remaining tasks, ask two questions:

1. **Do they touch the same files or generated output?** (e.g. both edit the
   same sheet-builder module, both regenerate the same manifest) → not safe
   to run at the same time, even in different sessions.
2. **Does one depend on the other's result?** (e.g. an acceptance-audit task
   that reviews everything before it, a "docs" task that describes what an
   earlier task built) → must run after, not alongside.

Only tasks that clear both checks — disjoint files, no ordering dependency —
go in the parallelizable set. When in doubt, treat a task as sequential; a
few extra minutes of serial work is cheaper than a merge conflict or a
half-consistent codebase.

Sequential-by-nature tasks are common at the end of a task list: a final
"docs" pass and a final "full acceptance audit" almost always depend on
everything before them being done, so they're rarely candidates for
splitting even when they look independent by title.

## Step 4 — Watch the shared-working-tree trap

Even two genuinely independent tasks can collide if both sessions run in the
**same checkout**: uncommitted changes from one can interleave with the
other's, `git status` gets confusing, and a half-finished edit from Session A
can end up in Session B's commit. Before dispatching parallel work, check
whether the sessions share a working directory:

- If yes, and the tasks touch disjoint files, it can still work — but prefer
  giving each session its own **git worktree** (see the
  `superpowers:using-git-worktrees` skill) so their edits and commits stay
  physically separate until it's time to merge.
- If the tasks are read-only (research, review, investigation) rather than
  edits, the shared-tree risk doesn't apply — those are the easiest and
  safest things to hand off.

## Step 5 — Propose the split before dispatching

Show the user the plan before sending anything: which task goes to which
session, and why each pairing is safe (disjoint files / no dependency /
read-only). This is cheap to do and catches cases where you're missing
context a human has (e.g. "session X is actually already looking at that
file, just not showing busy yet"). Get a go-ahead, then dispatch:

- Existing peer session → `SendMessage` with a self-contained brief (it has
  its own context; don't assume it remembers this conversation).
- No existing idle session for a task → spawn one with `Agent`, briefed the
  same way you'd brief any fresh agent: what to do, which files are in
  scope, what "done" looks like, and — critically — which files/areas are
  *out* of scope because another session owns them.

## Step 6 — Say what you're not parallelizing, and why

When you report the split back to the user, name the tasks you deliberately
kept sequential (and to which session/order), not just the ones you handed
off. That's the part of "don't create bugs" that's easy to silently skip —
make it visible instead.
