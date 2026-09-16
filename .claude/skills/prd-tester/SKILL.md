---
name: prd-tester
description: Audits whether built code actually matches a PRD/spec requirement exactly — no paraphrasing, no guessing at intent, no accepting "it typechecks" as proof. Extracts the requirement verbatim, runs the real acceptance test against real demo/fictional data, then deliberately tries to break it with adversarial edge cases (boundary values, race conditions, permission bypass, malformed input) before calling it a match. Draws on and grows a cross-project library of known pitfalls at references/lessons.md, so problems seen in one project get checked for automatically in the next. Iterates — fix code, re-verify — until behaviour and requirement agree 100%, or names exactly what's unverified. Use when asked to "verify this matches the PRD/spec", "audit T## against its requirements", "make sure this is really done", "stress test this", "try to break this feature", or before marking any spec-driven task complete.
---

# PRD Tester

A task gets checked off when someone believes the code satisfies a
requirement. This skill exists because belief is cheap and wrong belief is
expensive. Across projects the same shape of mistake keeps recurring:
something LOOKED verified and wasn't — an assertion that passed for the
wrong reason, a fixture that invented the shape it later checked,
"typecheck-clean" mistaken for evidence, a guard with no code path that
ever actually triggered it. This skill is the deliberate, repeatable
process for closing that gap, and it is meant to travel with you across
every project — `references/lessons.md` is a running library of exactly
these mistakes, generalized from real ones already found, so the next
project starts already knowing what to check for.

**The standard is 100% match, not "close enough."** If a requirement is
ambiguous, that is not license to guess at the friendliest interpretation —
quote the ambiguous text and flag it as an open question. A guessed match is
not a match.

## When to run this

- Before checking off any spec-driven task as done.
- When asked to audit, re-verify, or "make sure X really matches the spec."
- When asked to stress-test, edge-case, or "try to break" a feature.
- On a regression pass, to re-confirm something already marked done still
  holds after later changes touched shared code.

## Before starting: check the pattern library

Skim `references/lessons.md`. It's organised by tag (migrations,
windows-env, test-quality, concurrency, security, multi-tenant,
architecture, reporting, api-contracts, tooling, time) — jump to whatever
tags plausibly apply to the requirement and the stack in front of you.
Every entry is a real mistake made on a past project, generalized into a
pattern and a concrete check. Treat a hit as a specific thing to test for
here, not a guarantee this project has the same bug.

## Inputs: what are we checking?

Pin down, before doing anything else:

1. **The requirement(s)** — one or more requirement codes/IDs, a task
   reference, or a feature named in plain language. If the project tracks
   tasks against spec sections (a TASKS.md-style file), find the task's spec
   section reference and its quoted acceptance-test line.
2. **The source of truth** — the actual PRD/spec file. Never a summary of
   it, never memory of what it "basically says."
3. **The claimed implementation** — the code that's supposed to satisfy it.
   If nothing does, that's already your answer for that requirement: GAP.

If any of these is unclear, ask rather than assume — narrowing scope wrong
means auditing the wrong thing and reporting false confidence.

## The loop

### 1. Extract the requirement verbatim

Grep the PRD/spec for the requirement code or section marker. Quote the
actual sentence(s) in your working notes and in the final report —
word-for-word, not "it basically means X." Do the same for any named
acceptance evidence (a task's test line, or a spec scenario-table row).
Paraphrasing is where guessing sneaks in: a paraphrase quietly drops the
clause that was actually the hard part.

If a requirement has multiple clauses ("X, and Y, and never Z under
condition W"), split it — each clause gets its own verification, because a
test that only exercises the easy clause will report the whole requirement
green.

### 2. Map requirement clause → code

For each clause, find the specific code path that claims to satisfy it.
State the file and function, not "somewhere in the auth module." A clause
with no named code path is a **GAP** — write that down now, don't keep
looking for it to justify a MATCH later.

If the requirement's verb implies a user-facing surface (show, provide,
allow a person to...), confirm a route/screen actually exists — a library
function only a test can call does not satisfy "show" or "provide,"
however well it's tested. A well-tested function nobody can reach is still
a gap in what the requirement actually asked for.

### 3. Check test coverage is real, not decorative

Read the existing acceptance test if one exists. Ask, specifically:

- Does it call the **actual** function/route, or a hand-written fixture
  that assumes the shape of the record it later reads? A fixture that
  invents its own shape proves only that the test agrees with itself —
  see `references/lessons.md` [test-quality].
- Does it run for real, or does the task's history only show
  `tsc`/lint passing? **Typecheck-clean is not evidence.** A type checker
  will not catch a database write naming a column that doesn't exist, a
  wrong enum value, or a required field silently omitted — only running
  the code catches that.
- Is there a **CONTROL** — a case proving the mechanism can fail, right
  next to the case proving it passes? A guard test with no control can
  pass because the guard fired, or because nothing ever exercised the
  failure path at all, and those look identical from the outside.
  (Concretely: to prove "an article cannot self-approve," also prove a
  *different, eligible* approver *can* — otherwise "denied" might mean
  "the whole permission check is broken," not "self-approval is blocked.")

If no test exists, write one before trusting any manual "I checked and it
looked right" — see `superpowers:test-driven-development` for the general
discipline; here it's applied specifically against the requirement text
from step 1.

### 4. Run it against real demo/fictional data

Never real client/production data, ever — check the project's own stated
constraints, but treat this as a hard rule regardless of whether the
project says so explicitly. Use the project's own seed/demo mechanisms
where they exist, or build fictional fixtures inline. Run the test for
real and read its actual output — don't infer a pass from the code
looking plausible.

### 5. Try to break it — the adversarial pass

This is not optional polish; a requirement that only survives the happy
path is not verified. For the requirement's own domain, work through what
applies — cross-check against `references/lessons.md` for anything that
matches this stack or domain:

- **Boundary values.** Zero, empty, negative, maximum, exactly-at-the-limit.
  An empty denominator producing a rate of 0% (rather than "not available")
  is a real, recurring bug class — division and aggregation are the
  classic place this hides.
- **Concurrency / races.** Two callers doing the identical thing at once
  (two workers firing one reminder, two redemptions of one single-use
  link, two simultaneous approvals). A dedup-key/conditional-update
  pattern that looks right can still lose under real concurrency — fire
  both calls before either resolves, don't await them sequentially.
- **Every reachable path, not just the one you built.** If a record can be
  reached by URL, API, search, export, a background job, and a shared
  object link, an access rule proven on only one of those paths is
  unproven on the rest.
- **State-machine abuse.** Revoke/suspend/expire something mid-flight
  (mid-upload, mid-approval, mid-session) and confirm the in-flight
  operation is cut off rather than completing on stale authority.
- **Malformed / hostile input.** Wrong MIME masquerading as an allowed
  type, a zip bomb or corrupt archive, oversized payloads,
  injection-shaped strings in free-text fields, encoding tricks. Check the
  failure is refused cleanly with a real reason recorded — not a 500, not
  a silent accept.
- **Cross-tenant / cross-scope leakage.** If the system is multi-tenant or
  multi-scoped, repeat the check with a second, identical-looking record
  under a different scope and confirm it is neither counted, moved, nor
  disclosed.
- **Isolation claims vs. real config.** When a requirement claims
  something is separate/isolated (a failure domain, a key, a network
  path), check the actual configured value, not just that the mechanism
  exists — a different folder name on the same disk is not a separate
  failure domain, whatever the code comment hopes for. Read the real
  config, don't take the variable's name as proof of what it points to.
- **Tamper the evidence itself.** For anything hash-verified or
  audit-chained, flip one byte / one field and confirm the check actually
  detects it, then restore it and confirm the check goes green again
  (proves the check isn't vacuously always-pass).

Write down what you tried and what happened for each — "tried tampering,
it was caught" is a reportable line; "seems fine" is not.

### 6. Classify, per clause

- **MATCH** — verified: real test, real data, adversarial pass survived,
  control case confirms the mechanism can actually fail when it should.
- **GAP** — no code path claims to satisfy it.
- **MISMATCH** — code exists and runs, but does something other than what
  the requirement says (including "does the happy path but not the
  documented edge behaviour").
- **UNVERIFIED** — built, plausible, but not actually run against real
  behaviour yet (missing test, or a test that didn't survive its own
  control check). Never round this up to MATCH.
- **DEFERRED** — explicitly out of scope for this release per the spec
  itself (quote where it says so). Not the same as GAP — say which.
- **NEEDS OWNER DECISION** — the spec text is genuinely ambiguous, or
  verifying it needs something outside this codebase (e.g. an independent
  pen-test, a real external provider). State the exact ambiguity or
  blocker; do not resolve it by picking the interpretation that's
  convenient to already-written code.

### Confidence score

Alongside the MATCH/GAP/etc. label, give each clause a confidence score
(0-100%) for how sure you are the spec text and the running code actually
agree — the label says which bucket it's in, the score says how much to
trust that call. Compute it from evidence actually gathered, not from a
gut feeling:

- **90-100%** — real test, run against real demo data, survived an
  adversarial pass you personally tried (not just the ones the existing
  test already had), and a control case proves the mechanism can fail.
  Reserve 100% for a clause where you tampered the evidence yourself (bit
  flip, race, tried the bypass) and watched it get caught.
- **70-89%** — real test passes and covers the clause, but your own
  adversarial pass was thin, or you're relying on the existing test's
  control case rather than one you drove yourself.
- **40-69%** — code reads as correct and typechecks, but you have not
  personally run it, or the only evidence is the author's own log/notes.
  This is UNVERIFIED territory — the score should look unverified.
- **1-39%** — a plausible-looking match that you have active reason to
  doubt (an untested branch, an edge case you tried that misbehaved but
  didn't fully break, a requirement clause the test doesn't actually
  touch).
- **0%** — GAP: nothing claims to satisfy this clause.

A NEEDS OWNER DECISION clause gets no numeric score — say why instead.
Never inflate a score to make an overall audit look cleaner than the
weakest clause in it; the point of the number is to say plainly where
belief is still doing the work that evidence should be doing.

### 7. Fix and re-verify (the feedback loop)

For anything short of MATCH:

1. Decide whether the **code** is wrong or the **test** is wrong — don't
   assume. Re-read the requirement text from step 1 against what actually
   ran.
2. If the code is wrong, fix the code. **Never weaken an assertion to make
   a real requirement stop failing.** The one narrow exception: if the
   assertion itself is checking something the spec doesn't actually
   require (over-broad), tighten the assertion to match the spec — not to
   match whatever the code currently does.
3. If the test is wrong (fixture invents its own shape, no control case,
   asserts the wrong thing entirely), fix the test, and be explicit in
   your notes about which class of test bug it was — naming the pattern is
   what stops the next one, and is exactly the kind of thing worth
   proposing for `references/lessons.md`.
4. Re-run. Repeat until MATCH, or until you can only reach UNVERIFIED /
   NEEDS OWNER DECISION and say exactly why.

## Report format

Produce a table, one row per requirement clause:

| Code | Requirement (verbatim, short) | Status | Confidence | Evidence | Edge cases tried |
|------|-------------------------------|--------|------------|----------|-------------------|

Followed by, for anything not MATCH, a short paragraph: what's missing,
what was tried, and what would need to happen to close it (a fix, a
decision, an external step). Do not summarize a mixed result as "mostly
done" — list every non-MATCH clause by name.

End the report with one **overall confidence score** — the MINIMUM of the
individual clause scores, not an average. An average lets one perfectly
verified clause paper over one that's a guess; the overall claim "this
requirement matches the spec" is only as strong as its weakest clause.

If the project keeps a progress log, append findings there in its existing
format rather than only reporting in chat — the point is that the next
session (or the next person) inherits the verification, not just the
conversation.

## Hard rules

- Demo/fictional data only, ever — never real client, production, or
  personally identifying data, even to "just check something quickly."
- No requirement is MATCH on typecheck/lint alone.
- No requirement is MATCH without a control case showing the check can fail.
- An ambiguous requirement gets flagged, not silently resolved.
- A requirement outside this codebase's reach (pen-test, external
  certification, an integration nobody has credentials for yet) gets
  reported as NEEDS OWNER DECISION / blocked — never quietly dropped from
  the report.

## Improving this skill from real findings

This skill — and `references/lessons.md` in particular — is meant to get
better at catching things over time, the same way a project's own progress
log accumulates hard-won lessons. But it must not improve itself silently —
this file (and the pattern library) governs every future audit on every
future project, so a wrong or over-narrow lesson written in unreviewed
becomes a wrong lesson enforced forever, and nobody would know to question
it.

So: if a run surfaces a genuine blind spot — either in this skill's own
process, or a new pattern worth adding to `references/lessons.md` — draft
the addition and present it to the user as a proposed diff, together with
the concrete finding that revealed it. **Get explicit approval before
writing to either file.** Keep additions general (a class of check that
would catch the next instance on a *different* project too), not a narrow
note about the one case that happened to reveal it — a lesson that only
fires for the exact bug already fixed isn't a lesson, it's a fossil. When
proposing an addition to `lessons.md`, include: the pattern, why it
happens, and the concrete check that would catch it next time — the same
shape as the existing entries.
