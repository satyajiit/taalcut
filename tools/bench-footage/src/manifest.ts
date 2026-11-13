// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A generated set's manifest.json: what the set is (name, version, seed, the hash of its spec and the
 * generator), how it was made (FFmpeg's version, the voices that spoke), and each file: picture and audio,
 * length, every cut, dissolve and fade through black and every on-screen line with its time, the spoken language and probe word,
 * the size and SHA-256. The bench reuses a set while its manifest matches: same spec hash, every file there at
 * its size (and, when asked, its checksum).
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { FootageSet } from './sets/types';

/** Bump when the generator changes what it makes from the same spec. */
export const GENERATOR_VERSION = 1;

export const MANIFEST_FILE = 'manifest.json';

const clipSchema = z.object({
  file: z.string(),
  seconds: z.number().positive(),
  /** The picture as shown (portrait clips are stored landscape). */
  width: z.int().positive(),
  height: z.int().positive(),
  /** Display rotation in the container, degrees: -90 for a portrait clip, else 0. */
  rotation: z.int(),
  fps: z.int().positive(),
  codec: z.enum(['h264', 'hevc']),
  bitrate: z.string(),
  bed: z.enum(['none', 'music', 'noise', 'room']),
  speech: z.object({ language: z.string(), voice: z.string(), probe: z.string().nullable() }).nullable(),
  /** Why a planned speech track is missing (no voice for its language on the Mac that generated the set). */
  speechSkipped: z.string().nullable(),
  /** A fade (through black, IX3-D1) runs from `at` for `seconds`: its fade out, black and fade in. */
  cuts: z.array(z.object({ at: z.number(), kind: z.enum(['cut', 'dissolve', 'fade']), seconds: z.number() })),
  onScreen: z.array(z.object({ line: z.string(), from: z.number(), to: z.number() })),
  /** `dark`: a low-key shot (scripted clips only). */
  shots: z.array(
    z.object({ look: z.string(), startsAt: z.number(), seconds: z.number(), dark: z.boolean().optional() }),
  ),
  createdAt: z.string(),
  bytes: z.int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ClipManifest = z.output<typeof clipSchema>;

export const manifestSchema = z.object({
  v: z.literal(1),
  set: z.string(),
  setVersion: z.int(),
  seed: z.int(),
  specHash: z.string(),
  generatedAt: z.string(),
  generator: z.object({ version: z.int(), ffmpeg: z.string() }),
  totalSeconds: z.number().positive(),
  looksProbe: z.string(),
  clips: z.array(clipSchema).min(1),
});
export type Manifest = z.output<typeof manifestSchema>;

/** The set's spec with the generator's version: a change to either is a different set. */
export function specHash(set: FootageSet): string {
  return createHash('sha256')
    .update(JSON.stringify({ set, generator: GENERATOR_VERSION }))
    .digest('hex');
}

export function readManifest(dir: string): Manifest {
  const path = join(dir, MANIFEST_FILE);
  const parsed = manifestSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success)
    throw new Error(
      `${path}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  return parsed.data;
}

export async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export type FootageCheck =
  { readonly ok: true; readonly manifest: Manifest } | { readonly ok: false; readonly reason: string };

/** Whether `dir` holds `set` as generated: the manifest's spec hash, then every file's size (and checksum). */
export async function checkFootage(
  dir: string,
  set: FootageSet,
  options: { readonly checksums?: boolean } = {},
): Promise<FootageCheck> {
  if (!existsSync(join(dir, MANIFEST_FILE))) return { ok: false, reason: `no ${MANIFEST_FILE} in ${dir}` };
  let manifest: Manifest;
  try {
    manifest = readManifest(dir);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (manifest.specHash !== specHash(set))
    return { ok: false, reason: `${dir} holds another version of ${set.name} (spec hash differs)` };
  for (const clip of manifest.clips) {
    const path = join(dir, clip.file);
    if (!existsSync(path)) return { ok: false, reason: `${clip.file} is missing` };
    if (statSync(path).size !== clip.bytes) return { ok: false, reason: `${clip.file} changed size` };
    if (options.checksums === true && (await sha256(path)) !== clip.sha256)
      return { ok: false, reason: `${clip.file} changed (checksum)` };
  }
  return { ok: true, manifest };
}
