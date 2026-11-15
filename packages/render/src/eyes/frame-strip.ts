// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1 eyes: a stretch of a library clip as a strip of its frames, each with its time written on it.
 *
 * A clip's description says what happens over seconds; a contact sheet shows a dozen frames of its whole length. To
 * put one instant of a clip on a cut, the AI has to see when that instant is. This tool shows it: evenly spaced
 * frames between two seconds of the clip, in reading order, each tile labelled with its time in the clip, and the
 * same times as numbers beside the picture. Asked again over a narrower stretch, the tiles come a frame apart
 * (`everyFrame`). The tool finds nothing and judges nothing: the AI reads the strip and states the time (a slot's
 * part, to timeline.cast or timeline.assemble), and the tools that take a time apply it.
 *
 * One decode of the stretch (media's raw sampler: GPU decode first, HDR mapped, upright), the labels drawn with
 * media's 5×7 letters (our FFmpeg has no drawtext), the grid laid out here and encoded once. The pictures rule is
 * the eyes' (pictures.ts): the strip is the person's footage, so it goes to the run's model only where their frames
 * may; the artifact is there either way.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  artifactRefSchema,
  defineTool,
  err,
  NO_TOOL_RETRY,
  NotFoundError,
  NotImplementedError,
  ok,
  RationalTime,
  ulidSchema,
  ValidationError,
  type AnyTool,
  type ArtifactRef,
  type AssetId,
  type AsyncResult,
} from '@taalcut/core';
import {
  drawRgbPillBadge,
  planNormalisation,
  probeMedia,
  runFfmpeg,
  sampleFrames,
  type MediaContext,
} from '@taalcut/media';
import { z } from 'zod';
import type { EyesDeps } from './deps';
import { footagePicturesSchema, footageVerdict } from './pictures';

export const STRIP_TILES_MAX = 24;
export const STRIP_TILES_DEFAULT = 12;
/** A tile's long side, px: small enough that 24 tiles are one picture a model takes in, large enough to read. */
const TILE_LONG_SIDE = 256;
const GAP = 4;
const GREY = 0x80;
const READ = { filesystem: { read: ['library', 'app-data'] as const }, network: 'none' } as const;
const assetId = ulidSchema('Asset');

const r3 = (value: number) => Math.round(value * 1000) / 1000;

/** The grid frames a strip of `tiles` shows between two frames of the clip: both ends, the rest evenly between. */
export function stripFrames(first: number, last: number, tiles: number): number[] {
  const span = last - first;
  const count = Math.max(1, Math.min(tiles, span + 1));
  if (count === 1) return [first];
  return [...new Set(Array.from({ length: count }, (_, i) => first + Math.round((i * span) / (count - 1))))];
}

interface Tile {
  readonly frame: number;
  readonly rgb: Uint8Array;
}

/** The tiles in reading order on a grey ground, as one RGB picture. */
function layOut(tiles: readonly Tile[], size: { width: number; height: number }, columns: number) {
  const rows = Math.ceil(tiles.length / columns);
  const width = columns * size.width + (columns - 1) * GAP;
  const height = rows * size.height + (rows - 1) * GAP;
  const rgb = new Uint8Array(width * height * 3).fill(GREY);
  tiles.forEach((tile, index) => {
    const left = (index % columns) * (size.width + GAP);
    const top = Math.floor(index / columns) * (size.height + GAP);
    for (let y = 0; y < size.height; y++) {
      const from = y * size.width * 3;
      rgb.set(tile.rgb.subarray(from, from + size.width * 3), ((top + y) * width + left) * 3);
    }
  });
  return { rgb, width, height, rows };
}

async function encodeJpeg(
  media: MediaContext,
  scratch: string,
  image: { rgb: Uint8Array; width: number; height: number },
  signal: AbortSignal,
): AsyncResult<Buffer> {
  const work = await mkdtemp(join(scratch, 'strip-'));
  try {
    const raw = join(work, 'strip.rgb');
    const out = join(work, 'strip.jpg');
    await writeFile(raw, image.rgb);
    const run = await runFfmpeg(
      media,
      [
        ...['-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${image.width}x${image.height}`, '-i', raw],
        ...['-frames:v', '1', '-q:v', '4', '-pix_fmt', 'yuvj420p', out],
      ],
      // Raw pixels to one JPEG: no video decode, no GPU route (ADR 0002's "impossible" case).
      { holdsVideoSession: false, timeoutMs: 30_000, signal },
    );
    if (!run.ok) return run;
    return ok(await readFile(out));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export function frameStripTool(deps: Pick<EyesDeps, 'assets' | 'media' | 'pictures' | 'scratch'>): AnyTool {
  return defineTool({
    name: 'library.frameStrip',
    version: '1.0.0',
    description:
      'A stretch of one library clip as a strip of its frames in one image: evenly spaced tiles in reading order, ' +
      'each with its time in the clip (seconds) written in its corner, and the same times in `tiles`. For finding ' +
      'the instant something happens in a clip: read the strip, then ask again over the narrower stretch between ' +
      'the two tiles it happens between, until the tiles are one frame apart (everyFrame). Give that time where a ' +
      'tool takes one: a slot’s part (`parts` of timeline.cast and timeline.assemble; their `lands` says how). ' +
      'It comes back as a picture to a model that sees images where the person’s video may go to it (pictures ' +
      'says which).',
    summary: 'A stretch of a library clip as a strip of frames, each labelled with its time in the clip.',
    tags: ['library', 'frames', 'strip', 'look', 'clip', 'moment', 'time', 'when'],
    input: z.object({
      assetId,
      from: z
        .number()
        .min(0)
        .max(6 * 3600)
        .describe('Seconds into the clip where the strip starts'),
      to: z
        .number()
        .positive()
        .max(6 * 3600)
        .describe('Seconds into the clip where it ends'),
      tiles: z.int().min(2).max(STRIP_TILES_MAX).default(STRIP_TILES_DEFAULT),
    }),
    output: z.object({
      assetId,
      /** The stretch shown, in seconds of the clip: the first and the last tile's times. */
      from: z.number(),
      to: z.number(),
      /** The clip's whole length, in seconds. */
      clipSeconds: z.number(),
      image: artifactRefSchema,
      columns: z.int().positive(),
      rows: z.int().positive(),
      /** Each tile in reading order (from 1) with its time in the clip, as written on it. */
      tiles: z.array(z.object({ tile: z.int().positive(), seconds: z.number() })),
      /** Seconds between neighbouring tiles. */
      step: z.number(),
      /** The tiles are consecutive frames of the clip: there is nothing between them to look at. */
      everyFrame: z.boolean(),
      pictures: footagePicturesSchema,
      /** What was asked and could not be shown as asked, in plain words. */
      note: z.string().optional(),
    }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 120_000,
    retry: NO_TOOL_RETRY,
    permission: READ,
    images: (output) => (output.pictures.footage === 'shown' ? [output.image as ArtifactRef] : []),
    summarize: (output) =>
      `${output.tiles.length} frames of clip ${output.assetId}, ${output.from} to ${output.to} s, ` +
      `${output.everyFrame ? 'every frame' : `${output.step} s apart`}`,
    run: async (input, ctx) => {
      const original = await deps.assets.original(input.assetId as AssetId);
      if (!original.ok) return original;
      if (!original.value)
        return err(NotFoundError({ entity: 'asset', id: input.assetId }, { detail: 'The clip is offline' }));
      const media = await deps.media().catch(() => null);
      if (!media)
        return err(
          NotImplementedError({ feature: 'library.frameStrip' }, { detail: 'FFmpeg is not available here' }),
        );
      const { path } = original.value;
      const probed = await probeMedia(path, media, { signal: ctx.signal });
      if (!probed.ok) return probed;
      const plan = planNormalisation(probed.value);
      if (!plan.ok) return plan;
      if (plan.value.kind !== 'video' || plan.value.frames < 2)
        return err(
          ValidationError(
            { field: 'assetId' },
            { detail: 'This is a photo, one frame: library.frameAt shows it' },
          ),
        );
      const rate = plan.value.frameRate.output;
      const fps = rate.num / rate.den;
      const total = plan.value.frames;
      const clipSeconds = r3(total / fps);
      const secondsOf = (frame: number) => r3(frame / fps);
      if (input.to <= input.from || input.from >= clipSeconds)
        return err(
          ValidationError(
            { field: 'to' },
            { detail: `Give from < to inside the clip, which runs 0 to ${clipSeconds} s` },
          ),
        );
      const first = Math.min(total - 2, Math.max(0, Math.round(input.from * fps)));
      const last = Math.min(total - 1, Math.max(first + 1, Math.round(input.to * fps)));
      const frames = stripFrames(first, last, input.tiles);
      const got = new Map<number, Uint8Array>();
      const sampled = await sampleFrames(path, plan.value, media, {
        // Counted from the stretch's first frame, which the decode seeks to.
        frames: frames.map((frame) => frame - first),
        range: { start: RationalTime.of(first, rate), duration: RationalTime.of(last - first + 1, rate) },
        size: TILE_LONG_SIDE,
        format: 'rgb24',
        signal: ctx.signal,
        onFrame: (frame) => void got.set(first + frame.index, new Uint8Array(frame.data)),
      });
      if (!sampled.ok) return sampled;
      const size = { width: sampled.value.width, height: sampled.value.height };
      const shown = frames.filter((frame) => got.has(frame));
      if (shown.length === 0)
        return err(ValidationError({ field: 'from' }, { detail: 'No frame of that stretch could be read' }));
      const step = shown.length > 1 ? (shown[shown.length - 1]! - shown[0]!) / (shown.length - 1) / fps : 0;
      const everyFrame = shown.every((frame, index) => index === 0 || frame === shown[index - 1]! + 1);
      // Hundredths tell frames apart down to 60 a second; a finer strip is written in thousandths.
      const decimals = fps > 60 ? 3 : 2;
      const tiles = shown.map((frame) => {
        const rgb = got.get(frame)!;
        drawRgbPillBadge(rgb, size.width, size.height, secondsOf(frame).toFixed(decimals), {
          x: 4,
          y: 4,
          scale: 2,
        });
        return { frame, rgb };
      });
      const landscape = size.width > size.height;
      const columns = Math.min(tiles.length, landscape ? 4 : 6);
      const sheet = layOut(tiles, size, columns);
      const jpeg = await encodeJpeg(media, deps.scratch, sheet, ctx.signal);
      if (!jpeg.ok) return jpeg;
      const from = secondsOf(shown[0]!);
      const to = secondsOf(shown[shown.length - 1]!);
      const image = await ctx.artifacts.put({
        mediaType: 'image/jpeg',
        data: jpeg.value,
        summary: `Library clip ${input.assetId}, ${shown.length} frames from ${from} to ${to} s, times on the tiles.`,
      });
      if (!image.ok) return image;
      const asked = input.to > clipSeconds || shown.length < frames.length || shown.length < input.tiles;
      return ok({
        assetId: input.assetId,
        from,
        to,
        clipSeconds,
        image: image.value,
        columns,
        rows: sheet.rows,
        tiles: shown.map((frame, index) => ({ tile: index + 1, seconds: secondsOf(frame) })),
        step: r3(step),
        everyFrame,
        pictures: await footageVerdict(deps.pictures, ctx.signal),
        ...(asked
          ? {
              note:
                `The clip runs 0 to ${clipSeconds} s at ${r3(fps)} frames a second; this stretch has ` +
                `${last - first + 1} frames, ${shown.length} shown.`,
            }
          : {}),
      });
    },
  }) as AnyTool;
}
