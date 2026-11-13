// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs, isDirectRun } from '../entry';
import { scoreCostDir } from './score';

const USAGE = 'Usage: taalcut-evals cost --runs <dir>';

export function main(argv: string[]): number {
  try {
    const { values } = parseArgs({
      args: cliArgs(argv),
      options: { runs: { type: 'string' } },
      strict: true,
    });
    if (values.runs === undefined) throw new Error(`${USAGE}\n--runs is required`);
    const report = scoreCostDir(resolve(values.runs));
    if (report.pass) console.log(`${report.checked} estimates inside ±30% / ±$0.003.`);
    else {
      console.error(report.envelope.gate?.detail ?? 'Cost estimates failed');
      return 1;
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) process.exit(main(process.argv.slice(2)));
