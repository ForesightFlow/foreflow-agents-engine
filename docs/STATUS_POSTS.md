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

## Reveal-leak prevention

**Rule:** A round is never included in any status post until every prediction in that
round has been revealed on-chain **and** the round's `reveal_deadline` has passed.

Implementation in `getRevealedRoundsForAgent`:

```sql
SELECT round_id FROM predictions
WHERE agent_name = ?
  AND (reveal_deadline IS NULL OR reveal_deadline < ?)
GROUP BY round_id
HAVING COUNT(*) = COUNT(reveal_at)
```

- `HAVING COUNT(*) = COUNT(reveal_at)` ensures every prediction in the round has a
  non-null `reveal_at`.
- The `reveal_deadline` guard prevents posting when other agents in the same round
  could still be undercut by a leaked probability.

This query is the single authoritative filter used by both `postDailyStatus` and
`checkAndPostResolutionStatus`. Adding a new posting path without using this function
is a correctness bug.

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

Each resolution post run saves `last_resolution_post_at` to the DB immediately after
posting. If the process is killed between posts (multiple rounds pending), the rounds
whose posts completed are already recorded; the killed round will be re-posted on the
next cron tick. There is no deduplication guard beyond this timestamp — avoid running
multiple instances of the same agent's resolution cron simultaneously.
