# The cost table (BUILD.md 2.1) — first calibration, seeded from Overload 1.2

Dated 2026-10-30 (the 1.2.1 setup). Not a script: nothing runs it; `node --test "scripts/*.test.mjs"` ignores it. Never changed during a build; replaced with measured values at 1.2.1's close (BUILD.md, Bootstrap: "1.2.1's close replaces the seed with measured values").

## Models (API list prices per million tokens, 2026-10-30)

| Role | Tier | Model | Effort | Input | Output | Cache read |
|---|---|---|---|---|---|---|
| Coordinator | Opus | `claude-opus-5-5` | medium | $4 | $20 | $0.20 |
| Builder | Sonnet (Opus after two behaviour failures) | `claude-sonnet-5-5` | max | $2 | $10 | $0.20 |
| DATA reviewer | Opus | `claude-opus-5-5` | max | $4 | $20 | $0.20 |
| LIGHT batch reviewer | Sonnet | `claude-sonnet-5-5` | high | $2 | $10 | $0.20 |
| TASKS (sweep, gap pre-read, estimate) | Opus (Fable on trial) | `claude-fable-5-1` | max | $10 | $50 | $0.25 |

Cost-weighted tokens: re-reads × 0.1, writes × 2, output × 5, priced at the input rate.

## Per chunk type and size (seed; measured in 1.2.1)

| Type · size | Base cost (cost-weighted tokens) | Hours (review and merge included) | Share of the weekly limit | API price (the split below) |
|---|---|---|---|---|
| DATA · S / M / L | ≈ 30M (one seed for every size; a size scales it by about 0.6 / 1 / 1.4, unmeasured) | ≈ 1.5 h | ≈ 4.6% (proxy) | ≈ $84 |
| LIGHT · S / M / L | ≈ 11M (same note) | ≈ 40 min | ≈ 2.0% build + ≈ 1.5% per batch review (proxy) | ≈ $15 build + ≈ $10 per batch review |

- The hours are from 1.2's staging merges on 2026-10-26 (10 chunks in about 14 hours, two failed reviews included, no visible 5-hour stop).
- **The weekly share is a proxy** (BUILD.md Bootstrap: the ratio was measured in context size, not cost-weighted tokens): 1% of the Max (5x) weekly limit ≈ 0.39M context; a DATA chunk's recorded context budget ≈ 1.8M, a LIGHT chunk's ≈ 1.1M (1.2's hard stops). **1.2.1's first chunk (70) measures what 1% is in cost-weighted terms and each chunk's share of the week** (DECISIONS 267; LEARNINGS L16).
- The split per chunk for the API price: DATA builder 60% / reviewer 35% / coordinator 5%; LIGHT builder 70% / batch reviewer 25% (counted once per batch) / coordinator 5%.
- **The 5-hour window's size for the current plan (Max 5x): not measured.** `get_session` reports the window (`rateLimitType: five_hour`, `resetsAt`, `status`); 1.2's 14-hour run at this rate hit no stop. Chunk 70's report records the window's state before and after.

## One measured anchor

The 1.2.1 planning and setup sessions (one session, Fable 5.1, max): $49 at API rates by the end of the setup, 83.5M cache reads, 0.69M cache writes, 0.29M output tokens, 0.74M context.
