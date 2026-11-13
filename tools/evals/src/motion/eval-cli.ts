// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `pnpm --filter @taalcut/evals eval:motion -- --set <dir> [--out <predictions.json>] [--reuse] [--fit] [--jobs 4]
 * [--only <id prefix>]`: runs the camera-motion readers on the eval set built by build:motion (predict.ts) and prints
 * the bars per split (score.ts). `--reuse` keeps the predictions saved at `--out` and measures only the clips they lack; `--fit`
 * fits the classifier's thresholds on the train split and scores both splits with them (paste them into vision's
 * motion/config.ts).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { cliArgs, isDirectRun } from '../entry';
import { readJson, writeJson } from '../files';
import { requireMediaBinaries } from '../media-bin';
import { predictClip, type ClipPrediction } from './predict';
import type { MotionManifest } from './schema';
import { barsMet, fitThresholds, scoreBefore, scoreReadings, type BarScore, type ReaderName } from './score';

async function pool<T, R>(items: readonly T[], jobs: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, jobs) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await work(items[index]!);
      }
    }),
  );
  return out;
}

function line(name: string, score: BarScore): string {
  return (
    `${name}: ${score.right}/${score.clips} right (${(score.accuracy * 100).toFixed(1)}%), ` +
    `${score.unsure} unsure; static with a moving subject ${score.staticSubject.readStatic}/${score.staticSubject.clips}; ` +
    `zoom ${score.zoom.right}/${score.zoom.clips} right, ${score.zoom.wrongDirection} wrong direction; ` +
    `clear pan/tilt ${score.panTilt.right}/${score.panTilt.clips} right, ${score.panTilt.swapped} swapped`
  );
}

export async function runMotionEval(argv: string[]): Promise<Record<string, unknown>> {
  const { values } = parseArgs({
    args: cliArgs(argv),
    options: {
      set: { type: 'string' },
      out: { type: 'string' },
      reuse: { type: 'boolean' },
      fit: { type: 'boolean' },
      jobs: { type: 'string' },
      only: { type: 'string' },
    },
  });
  if (!values.set)
    throw new Error('Usage: eval:motion -- --set <dir> [--out <predictions.json>] [--reuse] [--fit]');
  const manifest = readJson(join(values.set, 'manifest.json')) as MotionManifest;
  const clips = manifest.clips.filter((clip) => !values.only || clip.id.startsWith(values.only));
  // --reuse keeps the saved predictions and measures only the clips they lack (a set that grew).
  const saved =
    values.reuse && values.out && existsSync(values.out) ? (readJson(values.out) as ClipPrediction[]) : [];
  const todo = clips.filter((clip) => !saved.some((p) => p.id === clip.id));
  let measured: ClipPrediction[] = [];
  if (todo.length > 0) {
    const binaries = await requireMediaBinaries();
    const media = { binaries };
    let done = 0;
    measured = await pool(todo, Number(values.jobs ?? 4), async (clip) => {
      const prediction = await predictClip(clip, join(values.set!, clip.file), media);
      done += 1;
      if (done % 25 === 0) process.stderr.write(`measured ${done}/${todo.length}\n`);
      return prediction;
    });
  }
  const predictions = clips.flatMap((clip) => [...saved, ...measured].find((p) => p.id === clip.id) ?? []);
  if (values.out && measured.length > 0) writeJson(values.out, predictions);
  const train = predictions.filter((p) => p.split === 'train');
  const heldout = predictions.filter((p) => p.split === 'heldout');
  const report: Record<string, unknown> = {};
  const readers: ReaderName[] = ['withBoxes', 'plain'];
  const fitted = values.fit ? fitThresholds(train, readers) : null;
  if (fitted)
    process.stdout.write(
      `fitted on train (both readers): ${JSON.stringify(fitted.thresholds)} (${fitted.right} right)\n`,
    );
  for (const reader of readers) {
    const thresholds = fitted?.thresholds;
    const scores = {
      train: scoreReadings(train, reader, thresholds),
      heldout: scoreReadings(heldout, reader, thresholds),
    };
    report[reader] = { ...(fitted ? { fitted } : {}), ...scores, bars: barsMet(scores.heldout) };
    process.stdout.write(
      `${line(`${reader} train`, scores.train)}\n${line(`${reader} held-out`, scores.heldout)}\n`,
    );
  }
  const ms = predictions.map((p) => p.plain.ms / Math.max(1, p.plain.pairs));
  report.before = { train: scoreBefore(train), heldout: scoreBefore(heldout) };
  report.msPerPair = Math.round((ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length)) * 10) / 10;
  process.stdout.write(
    `before (held-out): ${JSON.stringify(scoreBefore(heldout))}\nms per pair: ${String(report.msPerPair)}\n`,
  );
  if (values.out) writeJson(values.out.replace(/\.json$/, '') + '-report.json', report);
  return report;
}

if (isDirectRun(import.meta.url)) {
  runMotionEval(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exit(1);
  });
}
