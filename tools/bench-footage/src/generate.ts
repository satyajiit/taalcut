// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Makes a footage set (IX-B3): for each clip, its plan, the stills and text images its graph reads, its speech
 * (`say`, with the first of its voices this Mac has), the encode and the finishing copy, then its size and
 * checksum; the manifest last. Everything is written to `<out>.building` and moved into place when complete,
 * so a run that stops halfway never leaves a set that looks whole. `ensureFootage` reuses a set whose
 * manifest matches. FFmpeg and `say` are behind `FootageTools`, so planning is tested without them.
 */
import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { audioGraph, sayRun, type SayRun } from './audio';
import { encodeArgs, finishArgs, stillArgs } from './encode';
import {
  checkFootage,
  GENERATOR_VERSION,
  MANIFEST_FILE,
  sha256,
  specHash,
  type ClipManifest,
  type Manifest,
} from './manifest';
import { planClip, plannedSeconds, type ClipPlan } from './plan';
import type { ClipSpec, FootageSet } from './sets/types';
import { videoGraph } from './video/graph';

export interface FootageTools {
  /** Runs FFmpeg; rejects with what it printed when it fails. */
  ffmpeg(args: readonly string[]): Promise<void>;
  /** FFmpeg's first version line. */
  ffmpegVersion(): Promise<string>;
  /** The voices `say` has on this Mac. */
  voices(): Promise<readonly string[]>;
  say(run: SayRun): Promise<void>;
}

export interface GenerateOptions {
  readonly log?: (line: string) => void;
}

/** A shot as the manifest lists it (`dark` only on a scripted clip's low-key shots). */
const shotRow = ({ look, startsAt, seconds, dark }: ClipPlan['shots'][number]) => ({
  look,
  startsAt,
  seconds,
  ...(dark === true ? { dark } : {}),
});

async function makeClip(
  set: FootageSet,
  clip: ClipSpec,
  dirs: { readonly building: string; readonly work: string },
  tools: FootageTools,
  voices: ReadonlySet<string>,
): Promise<ClipManifest> {
  const plan = planClip(set, clip);
  if (Math.abs(plannedSeconds(plan) - clip.seconds) > 0.01)
    throw new Error(`${clip.file}: the plan is ${plannedSeconds(plan)} s, not ${clip.seconds} s`);
  const video = videoGraph(plan, dirs.work);
  for (const still of video.stills) await tools.ffmpeg(stillArgs(still, still.path));
  for (const text of video.texts) writeFileSync(text.path, text.ppm);
  const voice = clip.speech?.voices.find((name) => voices.has(name)) ?? null;
  let speechPath: string | null = null;
  if (clip.speech !== null && voice !== null) {
    const run = sayRun(clip.speech.text, voice, clip.seconds, join(dirs.work, `${clip.file}.aiff`));
    await tools.say(run);
    speechPath = run.path;
  }
  const speechInput = speechPath === null ? null : video.inputs;
  const audio = audioGraph(plan, speechInput);
  const encoded = join(dirs.work, `encoded${extname(clip.file)}`);
  await tools.ffmpeg(
    encodeArgs({
      plan,
      videoInputs: video.inputArgs,
      speech: speechPath,
      speechInput,
      filter: audio === null ? video.filter : `${video.filter};${audio}`,
      hasAudio: audio !== null,
      out: encoded,
    }),
  );
  const out = join(dirs.building, clip.file);
  await tools.ffmpeg(finishArgs(plan, encoded, out));
  // The work files of one clip can be gigabytes at 4K; keep only the finished file.
  rmSync(dirs.work, { recursive: true, force: true });
  mkdirSync(dirs.work, { recursive: true });
  return {
    file: clip.file,
    seconds: clip.seconds,
    width: clip.width,
    height: clip.height,
    rotation: clip.height > clip.width ? -90 : 0,
    fps: clip.fps,
    codec: clip.codec,
    bitrate: clip.bitrate,
    bed: clip.bed,
    speech:
      clip.speech === null || voice === null
        ? null
        : { language: clip.speech.language, voice, probe: clip.speech.probe },
    speechSkipped:
      clip.speech !== null && voice === null
        ? `no voice for ${clip.speech.language} (${clip.speech.voices.join(', ')})`
        : null,
    cuts: [...plan.cuts],
    onScreen: [...plan.texts],
    shots: plan.shots.map(shotRow),
    createdAt: clip.createdAt,
    bytes: statSync(out).size,
    sha256: await sha256(out),
  };
}

export async function generateSet(
  set: FootageSet,
  out: string,
  tools: FootageTools,
  options: GenerateOptions = {},
): Promise<Manifest> {
  const log = options.log ?? (() => undefined);
  const building = `${out}.building`;
  const work = join(building, '.work');
  rmSync(building, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const voices = new Set(await tools.voices());
  const clips: ClipManifest[] = [];
  for (const [index, clip] of set.clips.entries()) {
    const started = Date.now();
    clips.push(await makeClip(set, clip, { building, work }, tools, voices));
    log(
      `[footage] ${index + 1}/${set.clips.length} ${clip.file} in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
  }
  rmSync(work, { recursive: true, force: true });
  const manifest: Manifest = {
    v: 1,
    set: set.name,
    setVersion: set.version,
    seed: set.seed,
    specHash: specHash(set),
    generatedAt: new Date().toISOString(),
    generator: { version: GENERATOR_VERSION, ffmpeg: await tools.ffmpegVersion() },
    totalSeconds: clips.reduce((sum, clip) => sum + clip.seconds, 0),
    looksProbe: set.looksProbe,
    clips,
  };
  writeFileSync(join(building, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(out, { recursive: true, force: true });
  renameSync(building, out);
  return manifest;
}

/** The set in `dir`, generated first unless a matching one is there (`force` makes it again). */
export async function ensureFootage(
  set: FootageSet,
  dir: string,
  tools: FootageTools,
  options: GenerateOptions & { readonly force?: boolean; readonly checksums?: boolean } = {},
): Promise<{ readonly manifest: Manifest; readonly generated: boolean }> {
  if (options.force !== true) {
    const check = await checkFootage(dir, set, { checksums: options.checksums ?? false });
    if (check.ok) return { manifest: check.manifest, generated: false };
    options.log?.(`[footage] generating ${set.name} into ${dir}: ${check.reason}`);
  }
  return { manifest: await generateSet(set, dir, tools, options), generated: true };
}
