---
name: session-handoff
description: Record what happened this session into docs/SESSIONS.md so the next session — in either Claude Code or Command Code — can pick up cleanly. Use when the user says "wrap up", "handoff", "log this session", "I'm done for today", or before ending a work session. Also use at the START of a session to read the last entry and re-establish context.
argument-hint: "[start|end] (defaults to end)"
---

# Session handoff

Sweep is built with two agents — Claude Code and Command Code — used interchangeably.
Neither can see the other's conversation history. `docs/SESSIONS.md` is the only shared
memory between them. It is not a changelog; git already does that. It records **intent,
dead ends, and open threads** — the things that live in a conversation and die with it.

## Mode: start

Run when opening a session.

1. Read the **first entry** in `docs/SESSIONS.md` (newest is at the top).
2. Read `AGENTS.md`, and `BUILD-PLAN.md` §14 for build status.
3. Run `git log --oneline -10` and `git status --short` to see what actually landed
   versus what the last entry claimed.
4. Report back in three lines: where things stand, what the last session left open, and
   what you propose doing now. Then stop and wait — do not start work off the log alone.

If the log's "next up" and the git state disagree, say so. That gap is the most useful
thing the log produces.

## Mode: end (default)

Run before finishing. Do not skip steps because the session felt small.

### 1. Gather the facts

Run these and read the output — do not write the entry from memory:

```bash
git log --oneline "$(git log -1 --format=%H --before=@{6.hours.ago} 2>/dev/null || echo HEAD~10)"..HEAD 2>/dev/null | head -30
git status --short
git diff --stat HEAD
```

If the Supabase MCP is connected and the schema changed this session, also run
`list_migrations` and note anything applied.

### 2. Write the entry

Prepend to `docs/SESSIONS.md`, directly under the `<!-- newest first -->` marker. Never
append to the bottom, never edit a previous entry — if something in an old entry turned
out wrong, say so in the new one.

Use exactly this shape:

```markdown
## YYYY-MM-DD · <agent> · <2–5 word topic>

**Did**
- Terse, factual, one line each. What changed and where.

**Decided**
- Only decisions that outlive this session. Include the reasoning, briefly.
- Omit this section entirely if nothing was decided.

**Didn't work**
- Approaches tried and abandoned, and why. This is the highest-value section —
  it is what stops the other agent burning an hour rediscovering the same wall.
- Omit if genuinely nothing was abandoned.

**Open**
- Unfinished threads, known-broken things, questions for Noel.
- Say "nothing open" rather than deleting the heading.

**Next**
- The single most sensible next action, specific enough to start from cold.

**Touched** — `path/one.ts`, `path/two.sql`
```

`<agent>` is `claude-code` or `command-code`. Get the date from `date +%F`, not from
memory.

### 3. Rules for the entry

- **Terse.** Six lines beats sixteen. If it reads like prose, cut it.
- **No praise, no summary of how well it went.** Facts only.
- **Name files and functions**, not vague areas. "Fixed the RLS policies" is useless;
  "split `for all` write policies into insert/update/delete on 15 tables" is usable.
- **Record the false starts.** An entry with no "Didn't work" section on a hard session
  is a sign the entry is too shallow.
- If a decision contradicts `BUILD-PLAN.md`, update the plan too — the log records that
  a decision was made, the plan records what the decision *is*. Do not let them drift.

### 4. Update the build status

If the session moved a weekend forward in `BUILD-PLAN.md` §10, update the §14 status
table in the same commit. The log is chronological; §14 is the current state. Both are
needed.

### 5. Commit

```bash
git add -A && git commit -m "session: <same topic as the entry heading>"
```

Do not push unless asked.

## Keeping the file usable

Once `docs/SESSIONS.md` passes roughly 40 entries, fold everything older than the current
weekend into a single `## Archive — <period>` block at the bottom, keeping only the
Decided and Didn't-work lines. Never delete a "Didn't work" line.
