# DEMO-DATA-EXPLAINED.md — what's in the demo, and where to click

Plain English, no jargon. This is the "what can I actually look at" guide.
For project status see `PROGRESS.md` and `TASKS.md`. For the original setup
walkthrough see `SETUP-EXPLAINED.md`.

Everything described here is **completely fictional** — invented names,
invented GST numbers, invented bank details, all on `.invalid` email
domains. None of it is a real BHV client. This is on purpose: the project's
own rules say no real client data goes in until an owner-approved,
security-reviewed setup exists (see PROGRESS.md's open questions).

---

## 1. How to load the demo data (one time)

```
docker compose up -d db redis minio     # the database, cache, file store
npm run dev                              # the website itself
npm run seed:dev-user                    # once — creates your staff login
npm run seed:demo                        # once — fills the app with fictional content
```

`seed:demo` is safe to run again later — it won't duplicate the main data,
but it **will** print you a brand-new client-portal link each time (portal
links are single-use, like a one-time password link, so a fresh one is
minted every run).

---

## 2. Two separate "front doors" — staff vs. client

This app has two completely separate login systems, deliberately kept
apart (so a client can never end up looking at staff tools, and a client
password breach can never reach staff accounts):

| | Staff side | Client portal |
|---|---|---|
| URL | `localhost:3000/login` | printed by `seed:demo` as `localhost:3000/portal/sign-in/<token>` |
| Who | You, the firm | A fictional client contact |
| Login | Email + password + 6-digit code | A single-use link, no password |
| Get the code | `npm run dev:totp` (prints a fresh 6-digit code) | — |
| Credentials | `dev.owner@example.invalid` / `Dev-Local-Test-Passphrase-9` | link changes every `seed:demo` run |

---

## 3. What's actually in the demo (staff side)

Three fictional clients, each shaped differently on purpose so you can see
how the app treats them differently:

- **Meridian Textiles Private Limited** — a company, GST-registered, has
  an active annual GST engagement, an issued invoice that's part-paid, and
  an open client request.
- **Kalindi Foods LLP** — an LLP, GST-registered, a statutory tax audit.
- **Arunoday Charitable Trust** — a trust, deliberately has **no** GST
  number, to show the app doesn't force one where it doesn't apply.

From those three, here's what to go look at and where:

| Feature | Where to click | What you'll see |
|---|---|---|
| **Clients** (T07) | Clients → pick any of the three | Contact details, GST/PAN, who's allowed to act for them |
| **Engagements** (T08) | Client workspace → Engagements | The scope, fee basis, and dates of the work agreed |
| **Jobs / My work** (T09) | My work | 5 jobs in different states — in progress, in review, waiting on the client, ready, and one already completed (note: jobs aren't shown on the client workspace page itself, only in the queue screens like My work) |
| **Statutory calendar** (T10) | Calendar | 5 obligations: one due soon, one overdue, one where we don't even know the category yet (flagged, not guessed), and **two already filed** — one on time, one late |
| **Documents** (T11) | Client workspace → "Files" section, or the Documents screen | A client-supplied trial balance, an internal working paper (staff-only, never shown to the client), and an approved, signed report |
| **Communication** (T12) | Client workspace → "Open requests" section | An open request asking the client for a purchase register — see the note below, this is the only part of T12's demo data with a screen to view it on |
| **Client portal** (T13) | Use the printed portal link | The client's own view — their entity, their outstanding request, no staff names, no internal notes anywhere |
| **Billing** (T14) | Billing → the one invoice | An invoice for ₹1,18,000, part-settled: ₹88,000 received by bank transfer and ₹10,000 withheld as TDS — so you can see the app keeps "cash received" and "tax deducted" as separate, honest numbers rather than merging them |
| **Reports** (T17) | Reports → On-time filing rate | Because of the two filed obligations above, this report now shows a **real percentage**, not an empty "not available" |

**One honest gap worth flagging:** the demo also seeds a message thread — one
internal-only note and one message actually sent to the client — proving the
data model and its visibility rule work (checked directly against the
database and against the portal API). But as of this writing **no screen,
staff or portal, actually displays a message thread's contents** — the client
workspace page only has an "Open requests" table, not a message view. So you
can confirm the request is there, but not yet read the conversation itself
through the interface. This isn't something this seed script broke; it's an
existing gap in what's been built.

---

## 4. What the client portal itself shows

Sign in with the link `seed:demo` prints (it's single-use — get a new one
by running `npm run seed:demo` again). You'll be acting as **R. Deshpande**,
finance head at Meridian Textiles. You should see:

- Only Meridian Textiles — nothing about Kalindi Foods or the Trust.
- The open request: "Documents for GSTR-9," asking for a purchase register.
- A working upload screen for that request.
- A **verified** support contact under Help — and you will *not* see the
  second, unverified one that exists in the system (that's deliberate: an
  unverified phone number is withheld from clients until someone checks it).
- Nothing about internal staff — no names, no "who's working on this,"
  no internal notes. That's not a UI choice, it's enforced at the database
  query level (see PROGRESS.md's T13.3 note): those fields are never even
  fetched for a portal screen.

---

## 5. What's still empty / not clickable yet

Being upfront about the gaps, so you don't go looking for something that
isn't there yet:

- **No screen to create a NEW client, engagement, invoice, or fee
  arrangement by hand.** Those exist as backend logic and were tested that
  way, but nobody's built the "+ New" button yet for several of them. You
  can look, but not yet add through the interface.
- **Reports** only cover the 4 metrics the current data supports (on-time
  filing, work/review ageing, document completeness, receivables ageing).
  Three more from the PRD (time utilisation, engagement economics, practice
  quality) need data this build doesn't collect yet (R1 work) — deliberately
  not faked.
- **No admin screen** for support contacts (the "Client support" phone
  number) — that row was put in directly by the seed script; there's no
  button to edit it yet.

---

## 6. If you want to reset and start over

The demo data is tagged with one marker record. Deleting it and re-running
`npm run seed:demo` regenerates everything from scratch:

```sql
DELETE FROM "Party" WHERE "legalName" = 'Demo data marker — Meridian Textiles Private Limited';
```

(Run that against the `bhv_practice` database, then re-run `npm run
seed:demo`. Note this only deletes the marker, not the clients/jobs/etc.
themselves — ask before doing a full wipe, since that touches real rows.)
