// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fit bench (LRN1-TPL): `timeline.fitTemplates` for 200 templates against a 500-shot pool must answer in under
 * 2 s on a reference Mac. Everything but the embedder is the app's: the library database with sqlite-vec, the shot
 * profiles read from it (each shot's direction the mean of its eight 768-dimension frame vectors), the library's
 * template store, the template index and the fitter. Templates are indexed first (as the app does at write time);
 * the clock covers the fit alone: the first (cold) call, then the median, p95 and slowest of the timed runs.
 *
 *   pnpm --filter @taalcut/evals bench:template-fit [--templates 200] [--shots 500] [--runs 10]
 *       [--dir <empty folder>] [--out <result.json>]
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { arch, cpus, platform, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fitTemplatesInputSchema, ok, unwrap } from '@taalcut/core';
import { createShotProfileSource } from '@taalcut/library';
import { createTemplateFitter } from '@taalcut/timeline';
import { cliArgs, isDirectRun } from '../entry';
import { writeJson } from '../files';
import { benchEmbedder, benchTemplates, seedBenchShots } from './bench-library';
import { openTemplateWorld } from './world';

export const FIT_BENCH_TARGET_MS = 2000;

export interface FitBenchResult {
  readonly suite: 'template-fit-bench';
  readonly templates: number;
  readonly shots: number;
  readonly poolShots: number;
  /** The best fit's share of slots filled: a check that the pool really fills these templates. */
  readonly bestCoverage: number;
  readonly runs: number;
  readonly indexTemplatesMs: number;
  readonly coldMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly targetMs: number;
  /** The slowest timed run (not the cold one) under the target. */
  readonly pass: boolean;
  readonly machine: {
    readonly cpu: string;
    readonly memoryGb: number;
    readonly platform: string;
    readonly node: string;
  };
}

const round = (ms: number) => Math.round(ms * 10) / 10;

function sortedAt(sorted: readonly number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

export async function runFitBench(options: {
  readonly templates: number;
  readonly shots: number;
  readonly runs: number;
  readonly dir: string;
}): Promise<FitBenchResult> {
  const embedder = benchEmbedder();
  const indexStart = performance.now();
  const world = await openTemplateWorld({
    dir: options.dir,
    embedder,
    templates: benchTemplates(options.templates),
  });
  const indexTemplatesMs = performance.now() - indexStart;
  try {
    const { source, index } = seedBenchShots(world.db, options.shots, embedder.space.indexName);
    const fitter = createTemplateFitter({
      profiles: createShotProfileSource({ db: world.db, vectors: index }),
      templates: world.store,
      vectors: async () => ok(world.vectors),
    });
    const input = fitTemplatesInputSchema.parse({ pool: { sourceIds: [source] }, templates: {}, limit: 5 });
    const timed = async () => {
      const start = performance.now();
      const fitted = unwrap(await fitter.fitTemplates(input));
      return { ms: performance.now() - start, fitted };
    };
    const cold = await timed();
    const times: number[] = [];
    for (let run = 0; run < options.runs; run += 1) times.push((await timed()).ms);
    const sorted = [...times].sort((a, b) => a - b);
    const maxMs = sorted.at(-1) ?? cold.ms;
    return {
      suite: 'template-fit-bench',
      templates: cold.fitted.templates,
      shots: options.shots,
      poolShots: cold.fitted.poolShots,
      bestCoverage: cold.fitted.fits[0]?.coverage ?? 0,
      runs: options.runs,
      indexTemplatesMs: round(indexTemplatesMs),
      coldMs: round(cold.ms),
      medianMs: round(sortedAt(sorted, 0.5)),
      p95Ms: round(sortedAt(sorted, 0.95)),
      maxMs: round(maxMs),
      targetMs: FIT_BENCH_TARGET_MS,
      pass: maxMs < FIT_BENCH_TARGET_MS,
      machine: {
        cpu: cpus()[0]?.model ?? 'unknown',
        memoryGb: Math.round(totalmem() / 2 ** 30),
        platform: `${platform()} ${arch()}`,
        node: process.version,
      },
    };
  } finally {
    world.close();
  }
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      templates: { type: 'string' },
      shots: { type: 'string' },
      runs: { type: 'string' },
      dir: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  const given = values.dir === undefined ? undefined : resolve(values.dir);
  const dir = given ?? mkdtempSync(join(tmpdir(), 'taalcut-fit-bench-'));
  if (given) mkdirSync(given, { recursive: true });
  try {
    const result = await runFitBench({
      templates: Number(values.templates ?? 200),
      shots: Number(values.shots ?? 500),
      runs: Number(values.runs ?? 10),
      dir,
    });
    if (values.out !== undefined) writeJson(resolve(values.out), result);
    console.log(
      `fit: ${result.templates} templates × ${result.poolShots} shots: cold ${result.coldMs} ms, median ` +
        `${result.medianMs} ms, p95 ${result.p95Ms} ms, max ${result.maxMs} ms (target < ${result.targetMs} ms: ` +
        `${result.pass ? 'pass' : 'fail'}); best coverage ${result.bestCoverage}. Indexing the templates took ` +
        `${result.indexTemplatesMs} ms.`,
    );
    return result.pass ? 0 : 1;
  } finally {
    if (!given) rmSync(dir, { recursive: true, force: true });
  }
}

if (isDirectRun(import.meta.url)) {
  main(cliArgs(process.argv.slice(2))).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
