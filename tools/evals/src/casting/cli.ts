// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { timelineCastingSystem } from '../adapters/casting';
import { loadCastingManifest } from './library';
import { requireMediaBinaries } from '../media-bin';
import { DEFAULT_CASTING_WEIGHTS, syntheticCastingSystem } from '../adapters/synthetic-casting';
import { cliArgs, isDirectRun } from '../entry';
import { bundledFfmpeg } from '../ffmpeg-bin';
import { readJson, writeJson, writeText } from '../files';
import { writeCastingFixtures } from './fixtures';
import { predictCasting, scoreCastingDirs, writeCastingReport } from './run';
import { loadCastingCases, parseCastingWeights } from './schema';
import { tuneCasting } from './tune';

const USAGE = `Usage:
  eval:casting --labels <dir> --predictions <dir> --out <report.md>
  predict:casting --labels <dir> --out <dir> (--library <dir>... | --synthetic) [--weights <file>] [--variants <n>]
  fixtures:casting --out <dir>
  tune:casting --labels <dir> --weights <proposed.json> --out <report.md> (--library <dir>... | --synthetic)

--library is a casting library folder (manifest.json, clips/, templates/); repeat it for each library.`;

/** The timeline casting engine over the given library folders (each named by its manifest). */
async function realSystem(libraryDirs: readonly string[] | undefined, variants?: string) {
  if (libraryDirs === undefined || libraryDirs.length === 0) {
    throw new Error(`${USAGE}\n--library is required unless --synthetic`);
  }
  const libraries = Object.fromEntries(
    libraryDirs.map((dir) => [loadCastingManifest(resolve(dir)).library, resolve(dir)]),
  );
  return timelineCastingSystem({
    libraries,
    binaries: await requireMediaBinaries(),
    ...(variants === undefined ? {} : { variants: Number(variants) }),
  });
}

function weightsFrom(path: string | undefined) {
  if (path === undefined) return DEFAULT_CASTING_WEIGHTS;
  return parseCastingWeights(readJson(path), path);
}

async function evalCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { labels: { type: 'string' }, predictions: { type: 'string' }, out: { type: 'string' } },
    strict: true,
  });
  if (values.labels === undefined || values.predictions === undefined || values.out === undefined) {
    throw new Error(`${USAGE}\n--labels, --predictions and --out are required`);
  }
  const report = scoreCastingDirs(resolve(values.labels), resolve(values.predictions));
  writeCastingReport(report, resolve(values.out));
  const claim = report.claimed ? '' : ' Synthetic: not a gate result.';
  console.log(`${report.gate.detail}. ${report.gate.pass ? 'pass' : 'fail'}.${claim}`);
  return 0;
}

async function predictCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      labels: { type: 'string' },
      out: { type: 'string' },
      synthetic: { type: 'boolean' },
      weights: { type: 'string' },
      library: { type: 'string', multiple: true },
      variants: { type: 'string' },
    },
    strict: true,
  });
  if (values.labels === undefined || values.out === undefined) {
    throw new Error(`${USAGE}\n--labels and --out are required`);
  }
  const cases = loadCastingCases(resolve(values.labels));
  const weights = weightsFrom(values.weights === undefined ? undefined : resolve(values.weights));
  const system =
    values.synthetic === true ? syntheticCastingSystem(cases) : await realSystem(values.library, values.variants);
  const written = await predictCasting(system, cases, weights, resolve(values.out));
  console.log(`Wrote ${written.length} casting predictions to ${resolve(values.out)}`);
  return 0;
}

async function fixturesCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' } }, strict: true });
  if (values.out === undefined) throw new Error(`${USAGE}\n--out is required`);
  const bins = bundledFfmpeg();
  if (bins === undefined) throw new Error('ffmpeg is not available');
  const written = await writeCastingFixtures(resolve(values.out), bins.ffmpeg);
  console.log(`Wrote synthetic casting library ${written.libraryDir}`);
  return 0;
}

async function tuneCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      labels: { type: 'string' },
      weights: { type: 'string' },
      out: { type: 'string' },
      synthetic: { type: 'boolean' },
      start: { type: 'string' },
      library: { type: 'string', multiple: true },
    },
    strict: true,
  });
  if (values.labels === undefined || values.weights === undefined || values.out === undefined) {
    throw new Error(`${USAGE}\n--labels, --weights and --out are required`);
  }
  const cases = loadCastingCases(resolve(values.labels));
  const system = values.synthetic === true ? syntheticCastingSystem(cases) : await realSystem(values.library);
  const start = values.start === undefined ? DEFAULT_CASTING_WEIGHTS : parseCastingWeights(readJson(resolve(values.start)));
  const tuned = await tuneCasting(cases, system, start);
  writeJson(resolve(values.weights), tuned.weights);
  const lines = [
    '# Casting weight proposal',
    '',
    'Synthetic: yes. These numbers are not a gate result.',
    '',
    `Train libraries: ${tuned.trainLibraries.join(', ')}. Holdout: ${tuned.holdoutLibrary}.`,
    `Train pick acceptance: ${tuned.trainPickAcceptance.toFixed(3)}. Holdout pick acceptance: ${tuned.holdoutPickAcceptance.toFixed(3)}.`,
    `Proposed intent ${tuned.weights.intent}. This file does not change the engine.`,
    '',
  ];
  writeText(resolve(values.out), lines.join('\n'));
  console.log(`Wrote proposed weights ${resolve(values.weights)}`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  try {
    const args = cliArgs(argv);
    const command = args[0];
    const rest = cliArgs(args.slice(1));
    if (command === 'eval') return await evalCommand(rest);
    if (command === 'predict') return await predictCommand(rest);
    if (command === 'fixtures') return await fixturesCommand(rest);
    if (command === 'tune') return await tuneCommand(rest);
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
