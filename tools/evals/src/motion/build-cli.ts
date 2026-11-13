// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `pnpm --filter @taalcut/evals build:motion -- --out <dir> [--jobs 4] [--only <id prefix>]`: rebuilds the
 * camera-motion eval set (FRM1-MOT) in `<dir>`: fetches the CC0 and CC BY source photos (sources.ts), cuts the subject
 * sprites, renders every planned clip (plan.ts, render.ts) and writes `manifest.json` with each clip's label, path,
 * split and its subjects' boxes at 10 a second (what a subject tracker would give). Clips already rendered with the
 * same plan are kept. The set lives outside the repo; only this script is committed.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { promisify } from 'node:util';
import { cliArgs, isDirectRun } from '../entry';
import { writeJson } from '../files';
import { requireMediaBinaries } from '../media-bin';
import { planClips, type ClipPlan } from './plan';
import { clipArgs, spriteArgs, subjectBox, textureWindows } from './render';
import { fetchSources, type FetchedSource } from './sources';
import { MANIFEST_VERSION, type MotionManifest, type ManifestClip } from './schema';

const run = promisify(execFile);
const SUBJECT_RATE = 10;
const SPRITES_PER_PHOTO = 2;

/** The subjects' boxes at 10 a second from t = 0, one list per sample (what track.shot would give). */
export function subjectTrack(clip: ClipPlan): ManifestClip['subjectTrack'] {
  const samples = Math.floor(clip.seconds * SUBJECT_RATE) + 1;
  return Array.from({ length: samples }, (_, i) => {
    const t = Math.min(clip.seconds, i / SUBJECT_RATE);
    return {
      t,
      boxes: clip.subjects.flatMap((subject) => subjectBox(subject, clip, t) ?? []),
    };
  });
}

async function pool<T>(items: readonly T[], jobs: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, jobs) }, async () => {
      while (next < items.length) {
        const item = items[next++]!;
        await work(item);
      }
    }),
  );
}

export async function buildMotionSet(argv: string[]): Promise<MotionManifest> {
  const { values } = parseArgs({
    args: cliArgs(argv),
    options: { out: { type: 'string' }, jobs: { type: 'string' }, only: { type: 'string' } },
  });
  if (!values.out) throw new Error('Usage: build:motion -- --out <dir> [--jobs 4] [--only <id prefix>]');
  const dir = values.out;
  const jobs = Number(values.jobs ?? 4);
  const log = (line: string) => process.stderr.write(`${line}\n`);
  const sourcesDir = join(dir, 'sources');
  const clipsDir = join(dir, 'clips');
  const spritesDir = join(dir, 'sprites');
  for (const d of [sourcesDir, clipsDir, spritesDir]) mkdirSync(d, { recursive: true });
  const binaries = await requireMediaBinaries();
  const ffmpeg = binaries.ffmpeg;

  const sources = await fetchSources(sourcesDir, log);
  const backgrounds = sources.filter((s): s is FetchedSource & { split: 'train' | 'heldout' } =>
    Boolean(s.role === 'background' && s.split),
  );
  const subjects = sources.filter((s) => s.role === 'subject');

  const sprites: string[] = [];
  for (const source of subjects) {
    const photo = join(sourcesDir, source.file);
    const outs = Array.from({ length: SPRITES_PER_PHOTO }, (_, k) =>
      join(spritesDir, `${source.id}-${k}.png`),
    );
    if (!outs.every((out) => existsSync(out))) {
      // The photo's most textured person-sized windows, on a 384 px gray copy.
      const small = { width: 384, height: Math.round((384 * source.height) / source.width) };
      const raw = await run(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          photo,
          '-vf',
          `scale=${small.width}:${small.height}`,
          '-f',
          'rawvideo',
          '-pix_fmt',
          'gray',
          '-',
        ],
        { encoding: 'buffer', maxBuffer: 1 << 26 },
      );
      const windows = textureWindows(
        new Uint8Array(raw.stdout),
        small.width,
        small.height,
        SPRITES_PER_PHOTO,
      );
      for (const [k, out] of outs.entries())
        await run(ffmpeg, spriteArgs(photo, source, windows[k] ?? { x: 0.3, y: 0.3 }, out), {
          maxBuffer: 1 << 24,
        });
    }
    sprites.push(...outs);
  }

  const plans = planClips(backgrounds, sprites.length).filter(
    (clip) => !values.only || clip.id.startsWith(values.only),
  );
  const byId = new Map(backgrounds.map((b) => [b.id, b]));
  const previous = existsSync(join(dir, 'manifest.json'))
    ? (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as MotionManifest)
    : null;
  const same = new Map(previous?.clips.map((c) => [c.id, JSON.stringify(c.plan)]) ?? []);
  let made = 0;
  await pool(plans, jobs, async (clip) => {
    const file = join(clipsDir, `${clip.id}.mp4`);
    if (existsSync(file) && same.get(clip.id) === JSON.stringify(clip)) return;
    const photo = byId.get(clip.background)!;
    const args = clipArgs(clip, { photo: join(sourcesDir, photo.file), photoSize: photo, sprites }, file);
    try {
      await run(ffmpeg, args, { maxBuffer: 1 << 24 });
    } catch (error) {
      throw new Error(`${clip.id}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    made += 1;
    if (made % 20 === 0) log(`rendered ${made} clips`);
  });

  const manifest: MotionManifest = {
    version: MANIFEST_VERSION,
    about:
      'FRM1-MOT camera-motion eval set: clips rendered with FFmpeg from CC0 and CC BY photos (sources/sources.json) ' +
      'along known camera paths. Rebuilt by tools/evals/src/motion/build-cli.ts; never committed.',
    sprites: sprites.map((path) => path.slice(dir.length + 1)),
    clips: plans.map((plan) => ({
      id: plan.id,
      file: `clips/${plan.id}.mp4`,
      label: plan.label,
      split: plan.split,
      plan,
      subjectTrack: subjectTrack(plan),
    })),
  };
  writeJson(join(dir, 'manifest.json'), manifest);
  log(`${manifest.clips.length} clips (${made} rendered now) in ${dir}`);
  return manifest;
}

if (isDirectRun(import.meta.url)) {
  buildMotionSet(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
