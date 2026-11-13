// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs, isDirectRun } from '../entry';
import { writeText } from '../files';
import { writeGateFixtures } from './fixtures';
import { loadGateInputs } from './inputs/load';
import { buildReport } from './report/build';
import { renderHtml } from './report/html';
import { renderJson } from './report/json';
import { renderMarkdown } from './report/markdown';

const REPORT_USAGE = [
  'Usage: gates --gate beta|v1 --from YYYY-MM-DD --to YYYY-MM-DD --out <dir>',
  '  [--telemetry <dir>] [--evals <dir>] [--sessions <dir>] [--crashes <file>]',
  '  [--ci <dir>] [--manual <file>] [--cohorts <file>]',
].join('\n');

const FIXTURE_USAGE =
  'Usage: gates fixtures --out <dir> [--case pass|fail|synthetic|all]. Every file it writes says synthetic: true.';

function optional(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? resolve(value) : undefined;
}

function required(value: string | boolean | undefined, flag: string): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`${REPORT_USAGE}\n${flag} is required`);
  return value;
}

function writeReport(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      gate: { type: 'string' },
      telemetry: { type: 'string' },
      evals: { type: 'string' },
      sessions: { type: 'string' },
      crashes: { type: 'string' },
      ci: { type: 'string' },
      manual: { type: 'string' },
      cohorts: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  const out = resolve(required(values.out, '--out'));
  const inputs = loadGateInputs({
    gate: required(values.gate, '--gate'),
    from: required(values.from, '--from'),
    to: required(values.to, '--to'),
    telemetry: optional(values.telemetry),
    evals: optional(values.evals),
    sessions: optional(values.sessions),
    crashes: optional(values.crashes),
    ci: optional(values.ci),
    manual: optional(values.manual),
    cohorts: optional(values.cohorts),
  });
  const report = buildReport(inputs);
  writeText(join(out, 'report.json'), renderJson(report));
  writeText(join(out, 'report.md'), renderMarkdown(report));
  writeText(join(out, 'report.html'), renderHtml(report));
}

function writeFixtures(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string' },
      case: { type: 'string' },
    },
    strict: true,
  });
  const out = optional(values.out);
  if (out === undefined) throw new Error(`${FIXTURE_USAGE}\n--out is required`);
  const fixtureCase = values.case ?? 'all';
  if (
    fixtureCase !== 'all' &&
    fixtureCase !== 'pass' &&
    fixtureCase !== 'fail' &&
    fixtureCase !== 'synthetic'
  ) {
    throw new Error(`${FIXTURE_USAGE}\n--case must be pass, fail, synthetic, or all`);
  }
  writeGateFixtures(out, fixtureCase);
}

export function main(argv: string[]): number {
  try {
    const args = cliArgs(argv);
    if (args[0] === 'fixtures') {
      writeFixtures(cliArgs(args.slice(1)));
      return 0;
    }
    writeReport(args);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) process.exit(main(process.argv.slice(2)));
