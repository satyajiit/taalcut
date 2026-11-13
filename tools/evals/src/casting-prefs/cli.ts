// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-PREF's evals: the simulated creators (`eval:casting-prefs`), the overrides a real library already holds
 * (`real:casting-prefs`) and the golden set with the learned weights (`golden:casting-prefs`).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { castingWeightsSchema } from '@taalcut/core';
import { CASTING_CONFIG } from '@taalcut/timeline';
import { z } from 'zod';
import { writeCastingFixtures } from '../casting/fixtures';
import { loadCastingManifest } from '../casting/library';
import { loadCastingCases } from '../casting/schema';
import { cliArgs, isDirectRun } from '../entry';
import { bundledFfmpeg } from '../ffmpeg-bin';
import { readJson } from '../files';
import { requireMediaBinaries } from '../media-bin';
import { writeReport } from '../report';
import { parseNamed } from '../schema';
import { renderGoldenMarkdown, runGolden } from './golden';
import { readRealSwaps, renderRealMarkdown } from './real';
import { renderCastingPrefsMarkdown } from './report';
import { CASTING_PREFS_DEFAULTS, runCastingPrefs } from './run';

const USAGE = `Usage:
  eval:casting-prefs --out <report.md> [--seeds 42,7,1234] [--rounds 8] [--videos 5] [--exam 24]
  real:casting-prefs --db <a copy of library.sqlite> --out <report.md>
  golden:casting-prefs --weights <eval:casting-prefs report.json> --out <report.md> [--labels <dir> --library <dir>...]

golden without --labels writes the synthetic casting library (FFmpeg) and reads it.`;

const count = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${USAGE}\nnot a whole number: ${value}`);
  return parsed;
};

async function evalCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string' },
      seeds: { type: 'string' },
      rounds: { type: 'string' },
      videos: { type: 'string' },
      exam: { type: 'string' },
    },
    strict: true,
  });
  if (values.out === undefined) throw new Error(`${USAGE}\n--out is required`);
  const report = await runCastingPrefs({
    seeds:
      values.seeds === undefined
        ? CASTING_PREFS_DEFAULTS.seeds
        : values.seeds.split(',').map((seed) => count(seed, 1)),
    rounds: count(values.rounds, CASTING_PREFS_DEFAULTS.rounds),
    videosPerRound: count(values.videos, CASTING_PREFS_DEFAULTS.videosPerRound),
    examTemplates: count(values.exam, CASTING_PREFS_DEFAULTS.examTemplates),
  });
  writeReport(resolve(values.out), renderCastingPrefsMarkdown(report), report);
  const { pooled } = report;
  console.log(
    `Pairwise ${pooled.defaults.pairwise.rate.toFixed(3)} → ${pooled.learned.pairwise.rate.toFixed(3)}, top-1 ${pooled.defaults.topOne.rate.toFixed(3)} → ${pooled.learned.topOne.rate.toFixed(3)} (defaults → learned). Synthetic: not a gate result.`,
  );
  return Object.values(report.checks).every((check) => (typeof check === 'boolean' ? check : check.pass))
    ? 0
    : 1;
}

async function realCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { db: { type: 'string' }, out: { type: 'string' } },
    strict: true,
  });
  if (values.db === undefined || values.out === undefined)
    throw new Error(`${USAGE}\n--db and --out are required`);
  const report = readRealSwaps(resolve(values.db));
  writeReport(resolve(values.out), renderRealMarkdown(report), report);
  console.log(
    `${report.entries.personSwaps} swaps, ${report.pairs.count} pairs. ${report.enough ? 'Held out.' : 'Not enough to hold out.'}`,
  );
  return 0;
}

const learnedFile = z.object({
  personas: z.array(z.object({ seed: z.number(), persona: z.string(), learned: castingWeightsSchema })),
});

async function goldenCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      weights: { type: 'string' },
      out: { type: 'string' },
      labels: { type: 'string' },
      library: { type: 'string', multiple: true },
    },
    strict: true,
  });
  if (values.weights === undefined || values.out === undefined) {
    throw new Error(`${USAGE}\n--weights and --out are required`);
  }
  const learned = parseNamed(learnedFile, readJson(resolve(values.weights)), values.weights);
  const binaries = await requireMediaBinaries();
  const scratch = values.labels === undefined ? mkdtempSync(join(tmpdir(), 'taalcut-prefs-golden-')) : null;
  try {
    let labelsDir = values.labels === undefined ? '' : resolve(values.labels);
    let libraryDirs = (values.library ?? []).map((dir) => resolve(dir));
    if (scratch) {
      const ffmpeg = bundledFfmpeg();
      if (ffmpeg === undefined) throw new Error('FFmpeg is not available: run tools/ffmpeg/build.sh');
      const written = await writeCastingFixtures(scratch, ffmpeg.ffmpeg);
      labelsDir = written.labelsDir;
      libraryDirs = [written.libraryDir];
    }
    const report = await runGolden({
      cases: loadCastingCases(labelsDir),
      libraries: Object.fromEntries(libraryDirs.map((dir) => [loadCastingManifest(dir).library, dir])),
      binaries,
      weights: [
        { name: 'casting.v1', weights: CASTING_CONFIG.weights },
        ...learned.personas.map((run) => ({ name: `${run.persona}@${run.seed}`, weights: run.learned })),
      ],
    });
    writeReport(resolve(values.out), renderGoldenMarkdown(report), report);
    console.log(
      `Every learned set no worse than casting.v1 on the golden set: ${report.noWorse ? 'yes' : 'no'}.`,
    );
    return report.noWorse ? 0 : 1;
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

const COMMANDS = new Map<string, (argv: string[]) => Promise<number>>([
  ['eval', evalCommand],
  ['real', realCommand],
  ['golden', goldenCommand],
]);

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = cliArgs(argv);
  const command = name === undefined ? undefined : COMMANDS.get(name);
  try {
    if (!command) throw new Error(USAGE);
    return await command(cliArgs(rest));
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
