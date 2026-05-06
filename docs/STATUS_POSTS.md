# Status Posts

The engine posts two categories of automated tweets on behalf of each agent:

1. **Daily status** — cumulative performance stats, posted once per day at 18:00 UTC.
2. **Resolution status** — per-round outcome summary, posted once per resolved round
   (checked every 30 minutes).

Both post types are strictly **reveal-safe**: no prediction probabilities are published
until the agent has revealed its commitment on-chain and the round's reveal deadline has
passed.

---

## Daily status tweet

### When it fires

`ops/crontab.example` schedules `run-status.sh daily <agent>` at `0 18 * * *` (18:00 UTC).

### What it posts

```
[independent_ensemble configuration]

All-time stats:
Rounds participated: 42
Brier: 0.143  |  Market avg: 0.158
Alpha: +0.015

Past 24h: 3 rounds committed, 12 commits

foresightarena.xyz/agent/0xA1b38e…
```

Fields:
- **Configuration** — the agent's coordination mode (e.g. `independent_ensemble`, `debate`).
- **Timeframe** — `30-day` when the agent has ≥7 rounds or data older than 30 days;
  `All-time` otherwise.
- **Rounds participated** — count of rounds where ALL predictions have been revealed
  (unrevealed rounds are excluded).
- **Brier / Market avg** — cumulative mean Brier scores. `Market avg` is the mean of
  market baselines, providing a naive-baseline comparison.
- **Alpha** — `Market avg Brier − Agent Brier`. Positive means the agent beats the market
  prior. Shown only when `rounds ≥ 24` (too noisy before).
- **Past 24h** — recent rounds and on-chain commits in the last 24 hours.
- **Link** — `foresightarena.xyz/agent/<address>` when an agent address is available.

### Dry-run preview

```bash
foreflow-engine post-daily-status foreflow-ensemble --dry-run
```

Prints the composed tweet to stdout; no network call is made and no DB state is written.

### Retry behavior

On rate-limit errors (HTTP 429 or message containing "429"), the engine retries with
delays of 30 s, 60 s, and 120 s before giving up. Any other error is re-thrown immediately.

---

## Resolution status tweet

### When it fires

`ops/crontab.example` schedules `run-status.sh resolution <agent>` at `*/30 * * * *`
(every 30 minutes).

### What it posts

One tweet is posted **per resolved round** that has not been announced yet. The engine
tracks the last post timestamp in `runtime_state` and only processes rounds resolved
after that timestamp.

```
Round 506 resolved. 4 markets, 2 correct directions.
Avg Brier: 0.195

foresightarena.xyz/round/506
```

Fields:
- **Round ID** — Arena round identifier.
- **N markets** — number of markets in the round.
- **N correct directions** — markets where `probability > 0.5 AND outcome = 1` or
  `probability < 0.5 AND outcome = 0`.
- **Avg Brier** — mean `(probability − outcome)²` for this round.
- **Link** — `foresightarena.xyz/round/<roundId>`.

If the text exceeds 240 characters (unlikely), it falls back to a terse form:
`Round <id> resolved. <n> markets. foresightarena.xyz/round/<id>`

### Dry-run preview

```bash
foreflow-engine post-resolution-status foreflow-ensemble --dry-run
```

Prints any tweets that would be posted; does not update the last-post timestamp.

### State

The last post time is stored as `last_resolution_post_at:foreflow-ensemble` in the
`runtime_state` SQLite table. On dry-run this key is not written, so running dry-run
repeatedly will print the same pending tweets.

---

## Reveal-leak prevention guarantee

A round is never included in any status post (daily or resolution) unless ALL of these
conditions hold for every prediction the agent submitted in that round:

1. **All revealed on-chain** — every prediction in the round has `reveal_at IS NOT NULL`
   in the local DB (`HAVING COUNT(*) = COUNT(reveal_at)`).
2. **Deadline passed** — the round's `reveal_deadline`, if set, is in the past
   (`reveal_deadline IS NULL OR reveal_deadline < now`). A `NULL` deadline is treated as
   "no restriction" (see note below).
3. **(Resolution posts only)** — at least one of the agent's predictions in that round
   has `outcome IS NOT NULL` AND `resolved_at > last_resolution_post_at`, meaning there
   is actually something new to announce.

This ensures no directional or Brier-score information is published about predictions that
are still active in the commit or reveal phase.

### Implementation

| Post type | Helper | Source |
|---|---|---|
| Daily status | `getRevealedRoundsForAgent()` | `src/storage/predictions.ts` |
| Resolution status | `getResolvedAndRevealedRoundsForAgent()` | `src/storage/predictions.ts` |

Both helpers share the same first two guards (all-revealed + deadline). Adding a new
posting path without going through one of these helpers is a correctness bug.

The resolution-status live path additionally wraps the read → post → write cycle in a
`BEGIN IMMEDIATE` SQLite transaction so that parallel cron ticks cannot race on
`last_resolution_post_at` and post duplicate tweets.

### Note on `reveal_deadline`

The `reveal_deadline` column exists in the DB schema and is honoured by both query
helpers, but it is not currently populated by the JSONL event pipeline — the
`prediction_started` event type has no `revealDeadline` field. All production rows
therefore have `reveal_deadline = NULL`, which satisfies the `IS NULL` branch of the
guard (fail-open: no restriction applied). The "all revealed" guard (`COUNT(reveal_at)`)
provides the primary protection. To enable deadline enforcement, add `revealDeadline` to
the `prediction_started` event and emit it from agent subprocesses.

---

## Troubleshooting

### Tweet not posted after round resolves

1. Check the resolution timestamp: resolution posts only fire for rounds resolved
   **after** `last_resolution_post_at:{agentName}` in `runtime_state`.
2. Check reveal status: run the query in the "Reveal-leak prevention" section with
   your agent name and `strftime('%s','now')` as the second parameter. The round must
   appear in the result set.
3. Check `reveal_deadline`: if the round has a future deadline, it will be withheld
   until after that deadline even if all reveals are on-chain.

### Daily status shows 0 rounds

The stats query counts only revealed rounds. If the agent has predictions in `committed`
or `predicted` status, they are intentionally excluded until revealed.

### Rate-limit errors in the log

The engine retries automatically (30 s / 60 s / 120 s). If all retries fail, the tweet
is skipped and the state is not advanced — the next cron run will retry the same set of
pending posts.

### Duplicate tweets

The resolution post loop runs inside a `BEGIN IMMEDIATE` SQLite transaction. A second
process attempting the same agent's resolution run will block on that transaction (up to
10 s `busy_timeout`) and then read the already-advanced `last_resolution_post_at`,
finding no new rounds to post.

If the process is killed mid-loop (multiple rounds pending), the rounds whose tweets were
already sent have their `resolved_at` values already tracked; only the killed round will
be re-posted on the next cron tick. This is at-least-once delivery per round.
