# Token Launch Radar

A deterministic valuation model that ranks **204 tokenised protocols** by implied value — built for the make.fun "Token Launch Radar" bounty ($1,325 pool, result 28 Dec 2026).

## How it works
For each protocol: `implied value = TVL × category-median mcap/TVL`, where the multiple is winsorised and shrunk toward the global median, then adjusted for 7-day TVL growth, protocol age and chain reach. Same input → byte-identical output, every run.

## Contents
- `main.ts` — entrypoint: loads the snapshot, runs the model, writes predictions + dashboard data
- `lib/model.ts` — the valuation model
- `dashboard/` — static leaderboard UI (sortable board, per-protocol detail, category filter)

## Validation
Passed all 15 platform kit checks. Entry submitted 17 Nov 2026.

*Built by Kamal Mosadegh (freelance developer) with an autonomous AI development workflow.*
