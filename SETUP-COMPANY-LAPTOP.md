# Setting up this project on a new machine

## What `git clone` alone now gives you

This repo tracks everything needed to build immediately after cloning:
`CLAUDE.md`, `AGENTS.md`, `PRD.md`, `SPEC.md`, `TASKS.md`, `PROGRESS.md`, and
the three project skills under `.claude/skills/` (`project-builder`,
`prd-tester`, `session-work-split`). Claude Code picks these up automatically
— no copy/paste step required.

```bash
git clone https://github.com/prikshitmaster/BHV-AI-Spend-Tracker.git
cd BHV-AI-Spend-Tracker
git checkout r0-secure-core
npm install
npm run db:generate
```

`.env` is intentionally **not** in git (only `.env.example` is) — copy your
real `.env` over out-of-band (never via git/Slack/email in plaintext).

## The two things that can't travel via git (by design)

These are personal, machine-wide Claude Code settings — they apply to every
project you use Claude Code on, not just this repo, so they live in your home
directory (`~/.claude/`) instead of inside any one project:

- `~/.claude/CLAUDE.md`
- `~/.claude/RTK.md`

Copy these two files by hand from this laptop to the new one (same relative
path under your home directory), or paste their contents into a fresh Claude
Code session there and ask it to create them.

## Plugins (also can't come via git clone)

These were installed from the `claude-plugins-official` marketplace and need
reinstalling the same way on any new machine:

```bash
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install vercel@claude-plugins-official
claude plugin install frontend-design@claude-plugins-official
claude plugin install skill-creator@claude-plugins-official
claude plugin install claude-code-setup@claude-plugins-official
claude plugin install superpowers@claude-plugins-official
```

If this is a company-managed Claude Code install, IT policy may block plugin
marketplaces or hooks — if `claude plugin install` or the RTK hook does
nothing, that's the likely cause; check with IT rather than retrying.
