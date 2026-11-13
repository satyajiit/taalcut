// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { CutVerdict } from '@taalcut/templates';
import { syntheticBreakdownSystem } from '../adapters/synthetic-breakdown';
import { templateBreakdownSystem } from '../adapters/breakdown';
import { loadGoldenDir } from '../evaluate';
import { cliArgs, isDirectRun } from '../entry';
import { readJson } from '../files';
import { requireMediaBinaries } from '../media-bin';
import { buildBreakdownFixture } from './fixtures';
import { predictBreakdown, writeBreakdownSteps } from './run';

const USAGE = `Usage:
  taalcut-evals breakdown predict --golden <dir> --out <dir> [--synthetic] [--verdicts <dir>] [--steps <dir>]
  taalcut-evals breakdown fixtures --out <dir>

--verdicts holds <reelId>.json files ({ "verdicts": [{ "at": <frame>, "cut": <bool> }] }): the Analyst's
recorded judgements of disputed cuts. A reel without one is left to the rule.
--steps writes each method's cuts as predictions (<dir>/both, <dir>/proposals, <dir>/resolved).`;

function loadVerdicts(dir: string | undefined): Record<string, CutVerdict[]> {
  if (dir === undefined || !existsSync(dir)) return {};
  const verdicts: Record<string, CutVerdict[]> = {};
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
    const file = readJson(join(dir, name)) as { verdicts?: CutVerdict[] };
    verdicts[name.slice(0, -'.json'.length)] = file.verdicts ?? [];
  }
  return verdicts;
}

async function predictCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      golden: { type: 'string' },
      out: { type: 'string' },
      synthetic: { type: 'boolean' },
      verdicts: { type: 'string' },
      steps: { type: 'string' },
    },
    strict: true,
  });
  if (values.golden === undefined || values.out === undefined) {
    throw new Error(`${USAGE}\n--golden and --out are required`);
  }
  const goldenDir = resolve(values.golden);
  if (values.synthetic) {
    const cuts = Object.fromEntries(loadGoldenDir(goldenDir).map((reel) => [reel.reelId, [...reel.cuts]]));
    await predictBreakdown(syntheticBreakdownSystem(cuts), goldenDir, resolve(values.out));
  } else {
    const binaries = await requireMediaBinaries();
    const system = templateBreakdownSystem({
      media: { binaries },
      baseDir: goldenDir,
      verdicts: loadVerdicts(values.verdicts === undefined ? undefined : resolve(values.verdicts)),
    });
    await predictBreakdown(system, goldenDir, resolve(values.out));
    if (values.steps !== undefined) writeBreakdownSteps(system, resolve(values.steps));
  }
  console.log(`Wrote predictions to ${resolve(values.out)}`);
  return 0;
}

async function fixturesCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { out: { type: 'string' } },
    strict: true,
  });
  if (values.out === undefined) throw new Error(`${USAGE}\n--out is required`);
  const outDir = resolve(values.out);
  await buildBreakdownFixture(outDir);
  console.log(`Wrote breakdown fixtures to ${outDir}`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const args = cliArgs(argv);
    const command = args[0];
    const rest = cliArgs(args.slice(1));
    if (command === 'predict') return await predictCommand(rest);
    if (command === 'fixtures') return await fixturesCommand(rest);
    throw new Error(USAGE);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isDirectRun(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
