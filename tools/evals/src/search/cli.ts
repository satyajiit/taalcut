// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { IMAGE_TOKEN_BUDGETS, parseImageTokenBudget, type ImageTokenBudget } from '@taalcut/vision';
import { librarySearchSystem } from '../adapters/search';
import { parseSyntheticClips, syntheticSearchSystem } from '../adapters/synthetic-search';
import { cliArgs, isDirectRun } from '../entry';
import { bundledFfmpeg } from '../ffmpeg-bin';
import { queriesFromSearchCsv, writeSearchLabels } from './csv';
import { writeSearchFixtures } from './fixtures';
import { predictSearch, scoreSearchDirs, writeSearchReport } from './run';

const USAGE = `Usage:
  eval:search --labels <dir> --predictions <dir> --out <report.md>
  predict:search --library <dir> --labels <dir> --out <dir> [--synthetic]
                 [--work-dir <dir>] [--model-dir <dir>] [--no-ocr] [--image-tokens 70|140|280]
                 [--coreml-dir <embeddinggemma-2-coreml dir>]
  fixtures:search --out <dir>
  csv --kind search --in <sheet.csv> --out <dir>`;

async function evalCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { labels: { type: 'string' }, predictions: { type: 'string' }, out: { type: 'string' } },
    strict: true,
  });
  if (values.labels === undefined || values.predictions === undefined || values.out === undefined) {
    throw new Error(`${USAGE}\n--labels, --predictions and --out are required`);
  }
  const report = scoreSearchDirs(resolve(values.labels), resolve(values.predictions));
  writeSearchReport(report, resolve(values.out));
  const claim = report.claimed ? '' : ' Synthetic: not a gate result.';
  console.log(
    `hit@5 ${report.metrics[0]?.value.toFixed(3)} precision@5 ${report.metrics[1]?.value.toFixed(3)}. ${report.gate.pass ? 'pass' : 'fail'}.${claim}`,
  );
  return 0;
}

async function predictCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      library: { type: 'string' },
      labels: { type: 'string' },
      out: { type: 'string' },
      synthetic: { type: 'boolean' },
      'work-dir': { type: 'string' },
      'model-dir': { type: 'string' },
      'no-ocr': { type: 'boolean' },
      'image-tokens': { type: 'string' },
      'coreml-dir': { type: 'string' },
    },
    strict: true,
  });
  if (values.labels === undefined || values.out === undefined || values.library === undefined) {
    throw new Error(`${USAGE}\n--library, --labels and --out are required`);
  }
  if (values.synthetic === true) {
    const system = syntheticSearchSystem(clipsFromLibrary(resolve(values.library)));
    const written = await predictSearch(system, resolve(values.labels), resolve(values.out));
    console.log(`Wrote ${written.length} search predictions to ${resolve(values.out)}`);
    return 0;
  }
  const system = librarySearchSystem({
    libraryDir: resolve(values.library),
    ...(values['work-dir'] !== undefined ? { workDir: resolve(values['work-dir']) } : {}),
    ...(values['model-dir'] !== undefined ? { modelDir: resolve(values['model-dir']) } : {}),
    ...(values['no-ocr'] === true ? { ocr: false } : {}),
    ...(values['image-tokens'] !== undefined ? { imageTokens: imageTokens(values['image-tokens']) } : {}),
    ...(values['coreml-dir'] !== undefined ? { coremlDir: resolve(values['coreml-dir']) } : {}),
  });
  try {
    const written = await predictSearch(system, resolve(values.labels), resolve(values.out));
    console.log(`Wrote ${written.length} search predictions to ${resolve(values.out)} (library.search)`);
  } finally {
    await system.close();
  }
  return 0;
}

function imageTokens(value: string): ImageTokenBudget {
  const budget = parseImageTokenBudget(value);
  if (budget === undefined) throw new Error(`--image-tokens is one of ${IMAGE_TOKEN_BUDGETS.join(', ')}`);
  return budget;
}

function clipsFromLibrary(libraryDir: string) {
  const manifestPath = resolve(libraryDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { clips?: unknown };
  return parseSyntheticClips(manifest.clips, manifestPath);
}

async function fixturesCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' } }, strict: true });
  if (values.out === undefined) throw new Error(`${USAGE}\n--out is required`);
  const bins = bundledFfmpeg();
  if (bins === undefined) throw new Error('ffmpeg is not available');
  const written = await writeSearchFixtures(resolve(values.out), bins.ffmpeg);
  console.log(`Wrote synthetic search library ${written.libraryDir}`);
  return 0;
}

export async function searchCsvCommand(csvPath: string, outDir: string): Promise<number> {
  const queries = queriesFromSearchCsv(readFileSync(csvPath, 'utf8'));
  const written = writeSearchLabels(queries, outDir);
  console.log(`Wrote ${queries.length} search queries to ${written.length} library file(s)`);
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
