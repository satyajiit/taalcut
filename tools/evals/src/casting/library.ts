// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A casting eval library as the timeline engine sees it: one ShotProfile per
 * clip in the library's manifest. The clip's length, rate and orientation are
 * read from the file with @taalcut/media's ffprobe wrapper; what vision would
 * have stored about it (a description, camera motion, faces, quality) comes
 * from the manifest's `profile`, because the eval libraries are not indexed by
 * the app yet (H3). The description is embedded with the same deterministic
 * embedder as the slot intents (`hashingEmbedder`), never EmbeddingGemma, so
 * numbers measured on it are synthetic.
 */
import { join } from 'node:path';
import {
  CAMERA_MOTIONS,
  FrameRate,
  newId,
  ok,
  RationalTime,
  TimeRange,
  type AssetId,
  type Embedder,
  type Orientation,
  type ShotId,
  type ShotProfile,
} from '@taalcut/core';
import { probeMedia, type FfmpegBinaries } from '@taalcut/media';
import { z } from 'zod';
import { readJson } from '../files';
import { parseNamed } from '../schema';

const DIMS = 256;

/** What vision would have written about the clip. Every field is optional except the description. */
export const clipProfileSchema = z
  .object({
    description: z.string().min(1),
    motion: z.enum(CAMERA_MOTIONS).nullable().optional(),
    faces: z.number().int().nonnegative().optional(),
    quality: z.number().min(0).max(1).optional(),
    energy: z.number().min(0).max(1).nullable().optional(),
    place: z.string().min(1).nullable().optional(),
    /** ISO date-time of capture. */
    capturedAt: z.string().min(1).nullable().optional(),
  })
  .strict();

export const castingManifestSchema = z
  .object({
    library: z.string().min(1),
    synthetic: z.boolean(),
    clips: z
      .array(
        z
          .object({
            asset: z.string().min(1),
            frames: z.number().int().positive().optional(),
            color: z.string().optional(),
            profile: clipProfileSchema.optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type CastingManifest = z.infer<typeof castingManifestSchema>;

export interface LoadedLibrary {
  readonly name: string;
  readonly dir: string;
  readonly profiles: ShotProfile[];
  /** Manifest asset path by the profile's asset id. */
  readonly assetOf: ReadonlyMap<string, string>;
}

export function loadCastingManifest(dir: string): CastingManifest {
  const path = join(dir, 'manifest.json');
  return parseNamed(castingManifestSchema, readJson(path), path);
}

const tokens = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Feature-hashed bag of words, unit length. Shared words make texts close; nothing else does. */
export function hashText(text: string): Float32Array {
  const vector = new Float32Array(DIMS);
  for (const token of tokens(text)) {
    const hash = fnv1a(token);
    vector[hash % DIMS]! += (hash & 0x80000000) === 0 ? 1 : -1;
  }
  const norm = Math.hypot(...vector);
  if (norm === 0) {
    vector[fnv1a(text) % DIMS] = 1;
    return vector;
  }
  return vector.map((value) => value / norm);
}

/** The deterministic stand-in for EmbeddingGemma 2: the same space for slot intents and clip descriptions. */
export function hashingEmbedder(): Embedder {
  return {
    space: { model: 'evals-hashing', revision: '1', dimensions: DIMS, indexName: 'evals_hashing_1' },
    embedTexts: async (texts) => ok(texts.map(hashText)),
  };
}

const orientationOf = (width: number, height: number): Orientation =>
  width === height ? 'square' : width > height ? 'landscape' : 'portrait';

async function profileFor(
  dir: string,
  clip: CastingManifest['clips'][number],
  binaries: FfmpegBinaries,
): Promise<ShotProfile> {
  const probed = await probeMedia(join(dir, clip.asset), { binaries });
  if (!probed.ok) throw new Error(`${clip.asset}: ${probed.error.code} ${probed.error.detail ?? ''}`);
  const video = probed.value.video;
  if (!video?.frameRate) throw new Error(`${clip.asset}: no video stream with a frame rate`);
  const rate = FrameRate.of(video.frameRate.num, video.frameRate.den);
  const seconds = probed.value.duration ? probed.value.duration.value / probed.value.duration.rate : 0;
  const frames = video.frameCount ?? clip.frames ?? Math.round(seconds * FrameRate.toNumber(rate));
  const facts = clip.profile ?? { description: clip.asset };
  const captured = facts.capturedAt ? Date.parse(facts.capturedAt) : Number.NaN;
  const range = TimeRange.of(RationalTime.zero(rate), RationalTime.of(frames, rate));
  return {
    assetId: newId<'Asset'>() as AssetId,
    shotId: newId<'Shot'>() as ShotId,
    kind: 'video',
    range,
    available: range,
    orientation: orientationOf(video.displayWidth, video.displayHeight),
    quality: facts.quality ?? 0.8,
    sharpness: facts.quality ?? 0.8,
    motionClass: facts.motion ?? null,
    energy: facts.energy ?? null,
    faceCount: facts.faces ?? 0,
    placeClusterId: facts.place ?? null,
    objectTags: [],
    capturedAt: Number.isNaN(captured) ? null : captured,
    fileDate: Number.isNaN(captured) ? 0 : captured,
    duplicateGroup: null,
    bestTake: true,
    sourceId: null,
    embedding: hashText(facts.description),
    // Not measured here: in-points fall back to the sharpest (here: the earliest) window.
    motionCurve: null,
    sharpnessCurve: null,
    motionPeakFrames: [],
  };
}

/** Profiles for every clip of the library in `dir`, in manifest order. */
export async function loadCastingLibrary(dir: string, binaries: FfmpegBinaries): Promise<LoadedLibrary> {
  const manifest = loadCastingManifest(dir);
  const profiles: ShotProfile[] = [];
  const assetOf = new Map<string, string>();
  for (const clip of manifest.clips) {
    const profile = await profileFor(dir, clip, binaries);
    profiles.push(profile);
    assetOf.set(profile.assetId, clip.asset);
  }
  return { name: manifest.library, dir, profiles, assetOf };
}
