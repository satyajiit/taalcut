// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The template fit suite's commands (LRN1-TPL). */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs, isDirectRun } from '../entry';
import { bundledFfmpeg } from '../ffmpeg-bin';
import { requireMediaBinaries } from '../media-bin';
import { writeFitFixtures } from './fixtures';
import { loadTemplateLibrary } from './library';
import { predictFit, scoreFitDirs, writeFitReport } from './run';
import { loadFitCases } from './schema';
import { timelineFitSystem } from './system';

const USAGE = `Usage:
  eval:template-fit --labels <dir> --predictions <dir> --out <report.md>
  predict:template-fit --labels <dir> --library <dir>... --out <dir> [--work <empty dir>]
  fixtures:template-fit --out <dir>

--library is a template fit library folder (manifest.json and clips/ as the casting eval reads them, templates/ and
templates.json); repeat it for each library named by the labels.`;

async function evalCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { labels: { type: 'string' }, predictions: { type: 'string' }, out: { type: 'string' } },
    strict: true,
  });
  if (values.labels === undefined || values.predictions === undefined || values.out === undefined)
    throw new Error(`${USAGE}\n--labels, --predictions and --out are required`);
  const report = scoreFitDirs(resolve(values.labels), resolve(values.predictions));
  writeFitReport(report, resolve(values.out));
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
      library: { type: 'string', multiple: true },
      work: { type: 'string' },
    },
    strict: true,
  });
  if (values.labels === undefined || values.out === undefined || !values.library?.length)
    throw new Error(`${USAGE}\n--labels, --library and --out are required`);
  const libraries = Object.fromEntries(
    values.library.map((dir) => [loadTemplateLibrary(resolve(dir)).name, resolve(dir)]),
  );
  const workDir =
    values.work === undefined ? mkdtempSync(join(tmpdir(), 'taalcut-fit-eval-')) : resolve(values.work);
  mkdirSync(workDir, { recursive: true });
  const system = timelineFitSystem({ libraries, binaries: await requireMediaBinaries(), workDir });
  try {
    const written = await predictFit(system, loadFitCases(resolve(values.labels)), resolve(values.out));
    console.log(`Wrote ${written.length} template fit predictions to ${resolve(values.out)}`);
    return 0;
  } finally {
    await system.close();
    if (values.work === undefined) rmSync(workDir, { recursive: true, force: true });
  }
}

async function fixturesCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' } }, strict: true });
  if (values.out === undefined) throw new Error(`${USAGE}\n--out is required`);
  const bins = bundledFfmpeg();
  if (bins === undefined) throw new Error('ffmpeg is not available');
  const written = await writeFitFixtures(resolve(values.out), bins.ffmpeg);
  console.log(`Wrote synthetic template fit library ${written.libraryDir} and labels ${written.labelsDir}`);
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
