// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `pnpm --filter @taalcut/evals eval:motion-reel -- --truth <truth.json> --video <reel.mp4> [--runs 3]`: measures the
 * camera move of each of a reel's true shots with vision's estimator (no breakdown, no model) and scores the labels
 * against the truth file's fair motions (FRM1-MOT): how many are fair, how many moving shots read `static`, and
 * whether repeated runs agree. Prints one line per shot and the totals as JSON. For a quick read of the estimator on
 * a real reel; the breakdown's own result is scored with `eval:truth`.
 */
import { parseArgs } from 'node:util';
import { cameraMotion, classifyShot, shotFeatures } from '@taalcut/vision';
import { cliArgs, isDirectRun } from '../entry';
import { readJson } from '../files';
import { requireMediaBinaries } from '../media-bin';
import { truthSchema } from '../truth/schema';

export async function runReelMotion(argv: string[]): Promise<Record<string, unknown>> {
  const { values } = parseArgs({
    args: cliArgs(argv),
    options: {
      truth: { type: 'string' },
      video: { type: 'string' },
      runs: { type: 'string' },
      subject: { type: 'string' },
      'subject-from': { type: 'string' },
    },
  });
  if (!values.truth || !values.video)
    throw new Error('Usage: eval:motion-reel -- --truth <truth.json> --video <reel>');
  const truth = truthSchema.parse(readJson(values.truth));
  const media = { binaries: await requireMediaBinaries() };
  const ranges = truth.shots.map((shot) => ({ start: shot.startFrame, end: shot.endFrame }));
  // A diagnostic: one fixed subject box (x,y,w,h shares) from frame `subject-from` on, as a tracker might give.
  const box = values.subject?.split(',').map(Number);
  const from = Number(values['subject-from'] ?? 0);
  const subjects =
    box && box.length === 4
      ? (frame: number) =>
          frame >= from ? [{ x: box[0]!, y: box[1]!, width: box[2]!, height: box[3]! }] : undefined
      : undefined;
  const runs: (string | null)[][] = [];
  let ms = 0;
  for (let run = 0; run < Number(values.runs ?? 1); run++) {
    const started = performance.now();
    const result = await cameraMotion(values.video, { media }, { ranges, ...(subjects ? { subjects } : {}) });
    if (!result.ok) throw new Error(`${result.error.code}: ${JSON.stringify(result.error).slice(0, 800)}`);
    ms = performance.now() - started;
    const frame = { width: result.value.width, height: result.value.height };
    const labels = result.value.shots.map((shot, i) => {
      const measure = classifyShot(shot.pairs, frame);
      const fair = truth.shots[i]!.cameraMotions.includes(measure.label ?? '');
      if (run === 0)
        process.stdout.write(
          `shot ${i} [${shot.start}, ${shot.end}) ${measure.label} (${measure.confidence}) ${fair ? 'fair' : 'NOT fair'} ` +
            `pan ${measure.panX.toFixed(3)} tilt ${measure.panY.toFixed(3)} zoom ${measure.scale.toFixed(3)} ` +
            `jitter ${measure.jitter.toFixed(4)} steady ${String(measure.subjectSteady)} ` +
            `${JSON.stringify(shotFeatures(shot.pairs, frame), (_, v: unknown) => (typeof v === 'number' ? Number(v.toFixed(4)) : v))}\n`,
        );
      return measure.label;
    });
    runs.push(labels);
  }
  const first = runs[0]!;
  const totals = {
    shots: truth.shots.length,
    fair: first.filter((label, i) => truth.shots[i]!.cameraMotions.includes(label ?? '')).length,
    staticWhenMoving: first.filter((label, i) => label === 'static' && !truth.shots[i]!.static).length,
    runsAgree: runs.every((labels) => labels.every((label, i) => label === first[i])),
    msLastRun: Math.round(ms),
  };
  process.stdout.write(`${JSON.stringify(totals)}\n`);
  return totals;
}

if (isDirectRun(import.meta.url)) {
  runReelMotion(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
