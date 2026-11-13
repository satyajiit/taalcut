// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The listening suites (EAR1-I3), registered by id: each runs in turn, writes `<out>/<suite>/report.md` and
 * `report.json`, and prints one line. A suite that throws is a failure with its message; a skip is not a failure.
 */
import { join } from 'node:path';
import { LISTEN_SUITE_IDS, type ListenSuiteId } from '../ci/select-suites';
import { runBreakdownHitsSuite } from '../listen-breakdown-hits/suite';
import { runParitySuite } from '../listen-parity/suite';
import { runMoodSuite } from '../listen-pick/mood/suite';
import { runPickSuite } from '../listen-pick/suite';
import { crashed, type ListenOutcome } from './outcome';
import { writeOutcome, writeSummary } from './report';

export type ListenSuiteRun = (context: { readonly outDir: string }) => Promise<ListenOutcome>;

export const LISTEN_SUITES: Readonly<Record<ListenSuiteId, ListenSuiteRun>> = {
  'listen-pick': ({ outDir }) => runPickSuite(outDir),
  'listen-parity': () => runParitySuite(),
  'listen-breakdown-hits': () => runBreakdownHitsSuite(),
  'listen-mood': () => runMoodSuite(),
};

export function isListenSuite(id: string): id is ListenSuiteId {
  return (LISTEN_SUITE_IDS as readonly string[]).includes(id);
}

export async function runListening(
  ids: readonly ListenSuiteId[],
  outDir: string,
  options: {
    readonly suites?: Readonly<Record<ListenSuiteId, ListenSuiteRun>>;
    readonly log?: (line: string) => void;
  } = {},
): Promise<ListenOutcome[]> {
  const suites = options.suites ?? LISTEN_SUITES;
  const log = options.log ?? ((line: string) => console.log(line));
  const outcomes: ListenOutcome[] = [];
  for (const id of ids) {
    const started = performance.now();
    const dir = join(outDir, id);
    let outcome: ListenOutcome;
    try {
      outcome = await suites[id]({ outDir: dir });
    } catch (error) {
      outcome = crashed(id, error, (performance.now() - started) / 1000);
    }
    writeOutcome(outcome, dir);
    outcomes.push(outcome);
    log(`${id}: ${outcome.status}. ${outcome.detail} (${outcome.seconds.toFixed(1)} s)`);
  }
  writeSummary(outcomes, outDir);
  return outcomes;
}
