// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The study's frames (IX-E2): each subject photo framed four ways, as a
 * phone frame would hold it, then decoded and scaled through vision's own
 * frame path (`probeSource` + `sampleFrames`) at a budget's processor size.
 *
 * - `wide`: the photo cropped to 16:9 and filling a 1920×1080 frame;
 * - `tall`: cropped to 9:16, filling 1080×1920 (portrait phone footage);
 * - `small`: the whole photo at 480×480 on a 1920×1080 noisy grey frame,
 *   about 11% of the picture, placed differently per subject. Small subjects
 *   are where fewer tokens per frame lose detail first;
 * - `tiny`: the same at 240×240, about 3% of the picture.
 */
import { join } from 'node:path';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import type { EmbeddingImage } from '../../src/embed/model';
import { embeddingFrameSize, type ImageTokenBudget } from '../../src/embed/space';
import { probeSource, sampleFrames } from '../../src/media/frames';

export const FRAMINGS = ['wide', 'tall', 'small', 'tiny'] as const;
export type Framing = (typeof FRAMINGS)[number];

export interface FramedStill {
  readonly subject: string;
  readonly framing: Framing;
  readonly path: string;
}

function framingArgs(photo: string, framing: Framing, out: string, n: number): string[] {
  const head = ['-y', '-hide_banner', '-loglevel', 'error'];
  const tail = ['-frames:v', '1', '-update', '1', out];
  if (framing === 'wide') return [...head, '-i', photo, '-vf', 'crop=iw:iw*9/16,scale=1920:1080', ...tail];
  if (framing === 'tall') return [...head, '-i', photo, '-vf', 'crop=ih*9/16:ih,scale=1080:1920', ...tail];
  const side = framing === 'small' ? 480 : 240;
  const x = 120 + ((n * 317) % (1680 - side));
  const y = 80 + ((n * 211) % (920 - side));
  return [
    ...head,
    ...['-f', 'lavfi', '-i', 'color=c=0x707070:s=1920x1080,noise=alls=25:allf=u'],
    ...['-i', photo],
    ...['-filter_complex', `[1]scale=${side}:${side},format=rgb24[s];[0][s]overlay=x=${x}:y=${y}`],
    ...tail,
  ];
}

export interface SubjectPhoto {
  readonly id: string;
  readonly path: string;
}

/**
 * Renders every photo once per kind with FFmpeg into `dir` as `<id>-<kind>.<extension>`, in order; `args` gets the
 * photo, the kind, the output and the photo's index (to place it differently per subject).
 */
export async function renderPhotos<Kind extends string>(
  media: MediaContext,
  photos: readonly SubjectPhoto[],
  kinds: readonly Kind[],
  output: {
    readonly dir: string;
    readonly extension: (kind: Kind) => string;
    readonly args: (photo: string, kind: Kind, out: string, n: number) => string[];
  },
): Promise<{ readonly subject: string; readonly kind: Kind; readonly path: string }[]> {
  const out: { subject: string; kind: Kind; path: string }[] = [];
  for (const [n, photo] of photos.entries()) {
    for (const kind of kinds) {
      const path = join(output.dir, `${photo.id}-${kind}.${output.extension(kind)}`);
      const made = await runFfmpeg(media, output.args(photo.path, kind, path, n));
      if (!made.ok) throw new Error(`${photo.id} ${kind}: ${made.error.detail ?? made.error.code}`);
      out.push({ subject: photo.id, kind, path });
    }
  }
  return out;
}

/** Writes every subject's framings as PNGs into `dir`. */
export async function frameSubjects(
  media: MediaContext,
  photos: readonly SubjectPhoto[],
  dir: string,
): Promise<FramedStill[]> {
  const rendered = await renderPhotos(media, photos, FRAMINGS, {
    dir,
    extension: () => 'png',
    args: framingArgs,
  });
  return rendered.map(({ subject, kind, path }) => ({ subject, framing: kind, path }));
}

/** Each still decoded and scaled by FFmpeg to the budget's processor size, as `embedAsset` does. */
export async function loadFrames(
  media: MediaContext,
  stills: readonly FramedStill[],
  tokens: ImageTokenBudget,
): Promise<EmbeddingImage[]> {
  const frames: EmbeddingImage[] = [];
  for (const still of stills) {
    const source = await probeSource(media, still.path);
    if (!source.ok) throw new Error(`${still.path}: ${source.error.code}`);
    const size = embeddingFrameSize(source.value.width, source.value.height, tokens);
    const sampled = await sampleFrames(media, source.value, { size, format: 'rgb24', frames: [0] });
    if (!sampled.ok || !sampled.value[0]) throw new Error(`${still.path}: no frame`);
    const frame = sampled.value[0];
    frames.push({ width: frame.width, height: frame.height, rgb: frame.data });
  }
  return frames;
}
