// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The LRN1-CTX intent A/B commands, reached through `intents <command>` (see `./cli.ts`). */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { timelineCastingSystem } from '../adapters/casting';
import { DEFAULT_CASTING_WEIGHTS } from '../adapters/synthetic-casting';
import { loadCastingManifest } from '../casting/library';
import { loadCastingCases, parseCastingWeights } from '../casting/schema';
import type { SuiteEnvelope } from '../envelope';
import { readJson, writeJson, writeText } from '../files';
import { requireMediaBinaries } from '../media-bin';
import { jsonPathFor } from '../report';
import { armsAreSynthetic, loadArm, pairArms } from './ab-arms';
import { renderAbCastingMarkdown, runAbCasting } from './ab-casting';
import { abFixtures } from './ab-fixtures';
import { renderAbMarkdown, scoreAb, unblind } from './ab-score';
import { abKeySchema, abSheet } from './ab-sheet';

export const AB_USAGE = `Usage:
  intents ab --with <dir> --without <dir> --out <dir> [--seed <text>] [--synthetic]
  intents ab-score --sheet <rated.csv> --key <key.json> --out <report.md>
  intents ab-casting --labels <dir> --with <dir> --without <dir> --out <dir> --library <dir>... [--weights <file>]
  intents ab-fixtures --out <dir>

--with and --without are folders of <reel>.json templates: the same reels finalised by the Analyst with and
without slot context. ab writes sheet.csv (blind) and key.json; the rater fills usable1, usable2 and better.`;

/** The flag's value as an absolute path; a usage error when it is missing. */
function need(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${AB_USAGE}\n--${name} is required`);
  return resolve(value);
}

/** The suite's gate line on stdout, saying when it is synthetic. */
function printGate(envelope: SuiteEnvelope): void {
  const claim = envelope.claimed ? '' : ' Synthetic: not a gate result.';
  console.log(`${envelope.gate?.detail ?? ''}. ${envelope.gate?.pass ? 'pass' : 'fail'}.${claim}`);
}

function sheetCommand(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      with: { type: 'string' },
      without: { type: 'string' },
      out: { type: 'string' },
      seed: { type: 'string' },
      synthetic: { type: 'boolean' },
    },
    strict: true,
  });
  const arms = {
    with: loadArm(need(values.with, 'with')),
    without: loadArm(need(values.without, 'without')),
  };
  const synthetic = values.synthetic === true || armsAreSynthetic(arms);
  const { csv, key } = abSheet(pairArms(arms.with, arms.without), values.seed ?? 'lrn1-ctx', synthetic);
  const out = need(values.out, 'out');
  writeText(join(out, 'sheet.csv'), csv);
  writeJson(join(out, 'key.json'), key);
  const left = key.unpaired.reduce((sum, item) => sum + item.with.length + item.without.length, 0);
  console.log(
    `Wrote ${key.rows.length} rows to ${join(out, 'sheet.csv')} and the key beside it` +
      `${left > 0 ? `; slots that pair with nothing: ${left} (listed in the key)` : ''}.` +
      `${synthetic ? ' Synthetic: not a gate result.' : ''}`,
  );
  return 0;
}

function scoreCommand(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: { sheet: { type: 'string' }, key: { type: 'string' }, out: { type: 'string' } },
    strict: true,
  });
  const key = abKeySchema.parse(readJson(need(values.key, 'key')));
  const score = scoreAb(unblind(readFileSync(need(values.sheet, 'sheet'), 'utf8'), key), key);
  const out = need(values.out, 'out');
  writeText(out, renderAbMarkdown(score, key));
  writeJson(jsonPathFor(out), score);
  printGate(score.envelope);
  return 0;
}

async function castingCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      labels: { type: 'string' },
      with: { type: 'string' },
      without: { type: 'string' },
      out: { type: 'string' },
      library: { type: 'string', multiple: true },
      weights: { type: 'string' },
    },
    strict: true,
  });
  if (values.library === undefined || values.library.length === 0)
    throw new Error(`${AB_USAGE}\n--library is required`);
  const libraries = Object.fromEntries(
    values.library.map((dir) => [loadCastingManifest(resolve(dir)).library, resolve(dir)]),
  );
  const out = need(values.out, 'out');
  const report = await runAbCasting(
    timelineCastingSystem({ libraries, binaries: await requireMediaBinaries() }),
    {
      cases: loadCastingCases(need(values.labels, 'labels')),
      libraries,
      arms: { with: loadArm(need(values.with, 'with')), without: loadArm(need(values.without, 'without')) },
      outDir: out,
    },
    values.weights === undefined
      ? DEFAULT_CASTING_WEIGHTS
      : parseCastingWeights(readJson(resolve(values.weights))),
  );
  writeText(join(out, 'report.md'), renderAbCastingMarkdown(report));
  writeJson(join(out, 'report.json'), report);
  printGate(report.envelope);
  return 0;
}

function fixturesCommand(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' } }, strict: true });
  const dirs = abFixtures(need(values.out, 'out'));
  console.log(`Wrote synthetic arms ${dirs.with} and ${dirs.without}`);
  return 0;
}

const COMMANDS = {
  ab: sheetCommand,
  'ab-score': scoreCommand,
  'ab-casting': castingCommand,
  'ab-fixtures': fixturesCommand,
} satisfies Record<string, (argv: string[]) => number | Promise<number>>;

/**
 * The A/B command called `name`, or undefined for any other name. Running it gives 0 when it wrote its files,
 * and 1 with the reason on stderr when it couldn't.
 */
export function abCommand(name: string | undefined): ((argv: string[]) => Promise<number>) | undefined {
  const found = Object.entries(COMMANDS).find(([command]) => command === name);
  if (!found) return undefined;
  const [, run] = found;
  return (argv) =>
    Promise.resolve()
      .then(() => run(argv))
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
      });
}
