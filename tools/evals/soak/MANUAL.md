# Soak and durability (P3-Q3)

Long runs of the real app on the self-hosted runners. Not part of pull-request CI.

## When

- Weekly, and before the feature freeze (week 18).
- Self-hosted runners, both hardware tiers (minimum M1 8 GB, and the recommended tier).
- Never on pull requests. Smoke mode runs inside the package tests (`pnpm check`); there is no separate soak job.

## Lock

Hold the machine-wide VT lock (the hardware video lock) for the whole run, including the relaunch in the update scenario. Do not share the machine with another encode.

## Commands

Run these from `tools/evals`. The real app is wired later by the desktop lane: someone has to write the desktop port of `SoakApp` (`src/soak/scenario.ts`), including `integrity()`, which runs SQLite `integrity_check`, hashes every asset's file, checks the audit log, probes renders and lists scratch. The harness itself also checks every file imported during the run against the asset list at the end. This package does not import Electron. Until that app is connected, a full run records verdict `missing` with detail `no app wired` and does not start the 8 hour timer. Pass `--real` only once the desktop app is actually connected. That flag is the only way a full run sets `synthetic` to false. Smoke mode always uses the in-process fake and stays synthetic. No env var is required for smoke.

```sh
tsx src/soak/cli.ts run --scenario import-index-8h --mode full --out results/soak.jsonl --real
tsx src/soak/cli.ts run --scenario renders-50 --mode full --out results/soak.jsonl --real
tsx src/soak/cli.ts run --scenario update-under-load --mode full --out results/soak.jsonl --real
```

Smoke (seconds, an in-process fake, always `synthetic: true`; its rows are a check of this machinery, not a measurement):

```sh
tsx src/soak/cli.ts run --scenario all --mode smoke --out results/soak-smoke.jsonl
```

The process exits non-zero when any row is not `pass`. An unwired full run exits non-zero on purpose.

## Pass

- Memory growth at or under 10% for every process. The comparison is median RSS of the last hour against the median of the first hour after a 15 minute warm-up. For `renders-50` it is renders 41–50 against renders 6–15.
- Integrity clean: SQLite `ok`, no asset hash mismatch, no missing audit row, no invalid render, no orphan scratch, and every file imported during the run still present with its import hash.
- Update scenario: relaunch resumed, rollback restored, and no data lost.

Over 10% fails and names the process. Any integrity item that fails is named. A missing sample is verdict `missing`, not 0% growth.

## Results

Append-only JSONL, one object per line. Append to the perf-data branch the way P2-Q4 does. There is no trend table yet: read the rows by scenario and date.

## Not run here

The 8-hour run and the 50-render run were NOT executed in this lane. There is no measured growth number from a real app.
