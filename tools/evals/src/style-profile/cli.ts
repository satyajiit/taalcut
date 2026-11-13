// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The style profile suite's commands (LRN1-STY): no media, no model, so it runs anywhere in seconds. */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs, isDirectRun } from '../entry';
import { writeStyleProfileFixtures } from './fixtures';
import { scoreStyleProfiles, writeStyleProfileReport } from './run';
import { loadStyleProfileCases } from './schema';

const USAGE = `Usage:
  eval:style-profile --labels <dir> --out <report.md>
  fixtures:style-profile --out <dir>`;

function evalCommand(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: { labels: { type: 'string' }, out: { type: 'string' } },
    strict: true,
  });
  if (values.labels === undefined || values.out === undefined)
    throw new Error(`${USAGE}\n--labels and --out are required`);
  const report = scoreStyleProfiles(loadStyleProfileCases(resolve(values.labels)));
  writeStyleProfileReport(report, resolve(values.out));
  const claim = report.claimed ? '' : ' Synthetic: not a gate result.';
  console.log(`${report.gate.detail}. ${report.gate.pass ? 'pass' : 'fail'}.${claim}`);
  return report.gate.pass ? 0 : 1;
}

function fixturesCommand(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' } }, strict: true });
  if (values.out === undefined) throw new Error(`${USAGE}\n--out is required`);
  console.log(
    `Wrote the synthetic style profile labels to ${writeStyleProfileFixtures(resolve(values.out))}`,
  );
  return 0;
}

export function main(argv: string[]): number {
  try {
    const args = cliArgs(argv);
    const command = args[0];
    const rest = cliArgs(args.slice(1));
    if (command === 'eval') return evalCommand(rest);
    if (command === 'fixtures') return fixturesCommand(rest);
    throw new Error(USAGE);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) process.exit(main(process.argv.slice(2)));
