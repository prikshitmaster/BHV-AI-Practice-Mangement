# prd-tester — cross-project pattern library

Each entry is a real mistake found on a past project, generalized into a
pattern you can check for on a *different* one. Not a diary — every entry
earns its place by being a class of bug that could recur in unrelated code,
not a one-off fact about one project. See `SKILL.md`'s "Improving this
skill" section for how new entries get added (proposed, then approved —
never silent).

Jump by tag: [migrations](#migrations) · [windows-env](#windows-env) ·
[test-quality](#test-quality) · [concurrency](#concurrency) ·
[security](#security) · [multi-tenant](#multi-tenant) ·
[architecture](#architecture) · [reporting](#reporting) ·
[api-contracts](#api-contracts) · [tooling](#tooling) · [time](#time)

---

## migrations

### Auto-generated migration diffs can silently destroy data
**Pattern:** An ORM's "generate migration from schema diff" tool turns an
enum-value rename or a new required column into a `DROP COLUMN` /
recreate, discarding every existing row's value for that column.
**Why it happens:** The diff tool only sees the before/after shape, not
intent — it has no way to know "rename" was meant, only "old thing gone,
new thing appeared."
**Check for it:** Before applying any generated migration that touches an
*existing* column (rename, retype, new required field, enum value
change), read the raw SQL. If it drops and recreates, hand-edit to
`ALTER ... USING` / backfill instead. Also check whether the migration
runs inside a transaction — if not, write it idempotently (guard every
CREATE) so a mid-file failure doesn't leave partial state on retry.

---

## windows-env

### `localhost` resolving to `::1` breaks Docker-published-port connections
**Pattern:** A host-side process connecting to `localhost:PORT` for a
Dockerized service hangs for ~30s then fails with an opaque
connection-closed error, misread as "server under memory pressure" or
"connection pool exhaustion."
**Why it happens:** On Windows, `localhost` resolves to `::1` (IPv6)
before `127.0.0.1`, and Docker Desktop's published ports frequently don't
answer on IPv6 — the connection silently times out on the wrong address
family before ever trying IPv4.
**Check for it:** If a connection to a Dockerized service is intermittently
slow-then-failing on Windows, pin the connection string to the literal
`127.0.0.1`, not `localhost`, and compare timing before/after — a
7ms-in-container vs. 30s-over-localhost split confirms the diagnosis.

### PowerShell 5.1 corrupts BOM-less UTF-8 text files on write
**Pattern:** `Get-Content` / `Set-Content` (and similar cmdlets) round-trip
a UTF-8 file without a byte-order mark through the system ANSI codepage,
silently mangling em dashes, arrows, `≤`, and other non-ASCII characters —
non-uniformly, so a single find/replace can't undo it.
**Why it happens:** PowerShell 5.1's default encoding assumptions for
`Get-Content`/`Set-Content` don't preserve BOM-less UTF-8.
**Check for it:** Never rewrite an existing Markdown/text file with
PowerShell text cmdlets on Windows. Use a dedicated file-edit tool, or a
Node/Python script that explicitly reads/writes UTF-8. If a file already
looks corrupted, diff its non-ASCII byte patterns against version control
rather than guessing at manual fixes.

---

## test-quality

### An assertion can pass because nothing exercised the failure path at all
**Pattern:** A test proves "X is denied" without also proving a valid,
similar case succeeds — so "denied" might mean "the whole permission
check is broken and denies everything," not "this specific rule works."
Seen recurring independently across unrelated features in the same
project — same root cause each time, different code.
**Why it happens:** Writing the positive assertion (the thing you're
trying to prove) feels sufficient; the negative control feels redundant
until it isn't.
**Check for it:** Every guard/rule test needs a control case proving a
different, legitimate actor/input *succeeds* under the same code path —
otherwise you can't tell "the rule fired" from "everything is denied" or
"the check silently never ran."

### A fixture that invents its own shape only proves internal consistency
**Pattern:** A test hand-writes a database row (or API response) in the
shape it *expects* the real code to produce, then asserts against that
same hand-written shape — passing regardless of what the real function
actually does.
**Why it happens:** It's faster to construct fixture data directly than to
drive it through the real code path, especially for setup/arrange steps.
**Check for it:** Trace whether the object under test was produced by the
*actual* function/route being verified, not manually constructed to match
what the assertions expect. If setup must hand-build state, keep that
state minimal and unrelated to the specific field being asserted on.

### Typecheck-clean is not evidence of runtime correctness
**Pattern:** A change is trusted as correct because it compiles/typechecks,
but the actual data-layer call (e.g. an ORM `create`) references a
nonexistent column, a wrong enum value, or omits a required field —
all invisible to a type checker that only validates the TS-level shape,
not the schema the runtime actually enforces.
**Check for it:** Never accept "typechecks" as proof a data-writing code
path is correct. Run it for real against a real (test/demo) database and
read the actual result.

### A regex/string-match helper appending a suffix in the wrong place breaks the assertion silently
**Pattern:** A test helper builds a unique search string by appending a
run-id suffix (e.g. `tag("Foo")` → `"Foo-run123"`), but the code under
test needs the suffix somewhere else (prefix, middle) or matches a
different field entirely — the search then matches *nothing*, so an
isolation/security assertion "passes" whether or not the actual mechanism
works.
**Check for it:** For any test asserting "X cannot be found" or "X is
isolated," add a control search proving the *same* mechanism successfully
finds a record it legitimately should — if the control also fails to find
anything, the test isn't testing what it claims to.

### A canonical hash over structured data needs an explicit field order
**Pattern:** A tamper-detection hash is computed by serializing a
structured object (e.g. `JSON.stringify` over data that came from a
jsonb/dict column) whose key order isn't guaranteed — the hash then
"verifies" by luck of serialization, and can fail for reasons unrelated to
actual tampering, or vice versa pass over genuinely altered data.
**Check for it:** Any hash meant to detect tampering in structured data
should be computed over a fixed, explicitly-ordered field list (read named
fields, join in a stable order), never over a serializer whose ordering
guarantee you haven't confirmed. Prove it: alter one field, confirm the
hash check catches it; restore it, confirm the check passes again.

### Asserting a value appears somewhere cannot catch a swapped mapping
**Pattern:** The output carries two records with different expected values, and the test only checks
that each value appears *somewhere* in it — e.g. "the rendered page contains label A" and "contains
label B". If the code gives each record the other one's value, both strings are still present and the
test passes.
**Why it happens:** A presence check is the easiest assertion to write against rendered or serialized
output, and a fixture that holds one of each kind makes it look complete.
**Check for it:** Whenever a test covers a mapping from record to value, tie the assertion to that
record's own row, element or object, and also assert the *other* value is absent there. Prove it by
swapping the two values in the code and confirming the test fails.

### A test named with the wrong requirement ID is false evidence
**Pattern:** A test's title cites one requirement ("R66: …"), but its assertions check a different one.
An audit that maps evidence to requirements by title then marks the cited requirement as covered when
nothing actually exercises it.
**Why it happens:** IDs are typed from memory or copied from a neighbouring test, and nothing ever
checks a title against the body.
**Check for it:** When building a requirement-to-evidence table, read each cited test's *assertions*
against the requirement's verbatim text — never map evidence from titles alone. Any mismatch is two
findings: the requirement is uncovered, and the title must be corrected.

---

## concurrency

### A dedup/race fix needs to be tested under real concurrency, not sequentially
**Pattern:** A "two callers can't both succeed" fix (dedup key, conditional
update) is tested by calling it twice in sequence — which can pass even
when the actual race condition (both requests in flight simultaneously)
is unhandled.
**Check for it:** Fire both calls before either resolves — don't `await`
them one after another. Confirm exactly one row/effect is created and the
loser's response correctly reports itself as the duplicate/loser rather
than erroring.

---

## security

### A security guard can be fully built and never actually wired to anything
**Pattern:** A guard function (e.g. CSRF token verification) is written,
tested at the unit level, and correctly rejects invalid input — but no
code path ever *issues* the token/cookie it checks for, so every real
request through a browser is silently unreachable/rejected. The guard
"working" and the feature being usable are different claims.
**Check for it:** For any security control, trace the *issuing* side, not
just the *checking* side — walk a real client (browser session, real HTTP
call) through the full flow and confirm it actually succeeds, not just
that a unit test of the checker passes.

---

## multi-tenant

### A rule matched only by a shared business key can act cross-tenant
**Pattern:** A background process (e.g. "apply this change to all matching
records") selects candidates by a business key that isn't itself
tenant-scoped in its own table (shared across tenants by design, e.g. a
shared rule/template table) — so a change intended for one tenant matches
and mutates an identical record belonging to a different tenant.
**Check for it:** For any bulk-match/candidate-selection query, confirm
every clause is explicitly bound to the acting tenant/scope — including
any "how many were excluded" or "how many other candidates exist" count
alongside it. Test it directly: create a second tenant with an identical
record under the identical business key and prove it is neither matched
nor moved.

---

## architecture

### A bad import in a middleware/edge file takes down the whole app, not one feature
**Pattern:** Adding an unsupported import (e.g. a Node-only module) to a
middleware/edge-runtime file causes every route to fail, not just the one
feature the import was added for — because middleware runs before every
request, a bad import there is a total outage, not a partial one.
**Check for it:** Treat middleware/edge files as a restricted runtime, not
a normal server module — verify what's actually supported there before
adding a dependency, and if something added to middleware causes broad
500s, suspect the middleware file first regardless of what feature was
being worked on.

### A shared endpoint's contract can be changed by one feature and break a different, unrelated consumer
**Pattern:** An API response shape is changed to suit the feature being
built, and a completely different, pre-existing caller of that same
endpoint — outside the diff anyone is looking at — breaks because it read
a field name that no longer exists.
**Check for it:** Before changing a shared endpoint's response shape,
search the whole codebase for every consumer of it, not just the one
being modified. Fix the endpoint to serve both needs (e.g. add rather than
rename a field) rather than repointing the other consumer to a second,
possibly-divergent source of the same data.

---

## reporting

### An empty denominator must read "not available," never zero
**Pattern:** A rate/percentage computed as `numerator / denominator` where
the denominator can legitimately be zero (no data yet) silently renders as
0%, which is visually and semantically indistinguishable from "measured
and genuinely bad."
**Check for it:** Any ratio/rate calculation needs an explicit
"insufficient data" / null state for a zero or missing denominator, tested
directly — assert the empty case renders as unavailable, not as 0.

---

## api-contracts

*(See "A shared endpoint's contract can be changed..." under
[architecture](#architecture) — same class of bug, listed there since it's
usually caught while working on a different architectural layer.)*

---

## tooling

### A wrapper/proxy CLI can report a result for a command that never ran correctly
**Pattern:** A token-saving or output-filtering wrapper around a real tool
(linter, test runner, search tool) summarizes a run whose underlying
invocation actually failed to start or errored — the wrapper's summary
looks like a normal, slightly terse result, not an error.
**Check for it:** When a wrapped tool's output disagrees with what you
expect (a lint pass that seems too clean, a search returning nothing for
something you know exists), re-run the underlying command directly,
unwrapped, before trusting the summary.

### "No usages found" can miss access through an alias
**Pattern:** A search for a fully qualified path (`config.accent`) finds only the definition, so the
value is reported as unused or unimplemented. The code actually reaches it through an alias
(`var c = config; … c.accent`) or dynamic access (`config[key]`), which that pattern cannot see.
**Why it happens:** The first search matches the obvious spelling, and an empty result feels
conclusive.
**Check for it:** Before recording "unused" or "missing", widen the search: the literal value, aliases
of the parent object, and dynamic property access. Prefer a small script that lists every read of the
object over a single grep, and treat an empty result as "widen the search", not as a finding.

### A planted-bug (mutation) script can report nonsense without erroring
**Pattern:** A script plants a bug by replacing text in the source and then runs the relevant test.
Its own failure modes read like results: the anchor matches twice, so the wrong spot is mutated; the
anchor matches nothing because it assumed LF while the file uses CRLF; a test-name filter matches no
test because the real name contains regex or special characters, so zero tests run and it looks like
"survived"; or a mutant that never applied still gets a verdict.
**Why it happens:** The harness around the mutation gets far less scrutiny than the code under test.
**Check for it:** Refuse unless the anchor matches **exactly once**, matching on the file's actual
bytes including line endings. Assert each filtered run executed at least one test. Report a mutant
that failed to apply as **NOT APPLIED**, never as caught or survived. Restore the file after each
mutant and confirm a clean diff at the end.

---

## time

### A fixed literal time window can silently exclude a boundary instant
**Pattern:** A test (or the code itself) treats `00:00`-`23:59` as "the
whole day," which excludes the last minute of the day — a quiet-hours or
scheduling check built or tested against that literal range has a
once-a-day gap that's easy to never notice.
**Check for it:** Anchor time-window logic and its tests on relative
boundaries (start-of-day to just-before-next-start-of-day, or the current
moment) rather than a fixed literal range, and specifically test the
instant right at the boundary, not just clearly-inside/clearly-outside
values.
