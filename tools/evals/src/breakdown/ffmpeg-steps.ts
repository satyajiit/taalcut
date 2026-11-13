// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The breakdown's media steps on the app's FFmpeg build, through
 * @taalcut/media's runner (its prelude, environment and errors): normalise
 * (VideoToolbox decode and encode, ADR 0002), frame extraction, the contact
 * sheet and the luma curve. They mirror what the jobs process's media
 * functions do for the app, so the eval measures the pipeline, not these.
 */
import { mkdir, readdir, rename, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, UnknownError, type AsyncResult } from '@taalcut/core';
import { framesExpression, rangesExpression, runFfmpeg, runProcess, type MediaContext } from '@taalcut/media';
import type { BreakdownMedia } from '@taalcut/templates';
import { h264Route } from '../h264-route';

const fail = (detail: string) => err(UnknownError(undefined, { detail }));

async function countFrames(ctx: MediaContext, path: string, signal: AbortSignal): AsyncResult<number> {
  const counted = await runProcess(
    ctx.binaries.ffprobe,
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-count_packets',
      '-show_entries',
      'stream=nb_read_packets',
      '-of',
      'csv=p=0',
      path,
    ],
    { signal },
  );
  if (!counted.ok) return counted;
  const frames = Number(counted.value.stdout.toString('utf8').trim());
  return Number.isInteger(frames) ? ok(frames) : fail(`ffprobe counted no frames in ${path}`);
}

export const normalise =
  (ctx: MediaContext): BreakdownMedia['normalise'] =>
  async (path, { outPath, rate, width, crop, signal }) => {
    const filters = [
      ...(crop ? [`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`] : []),
      `fps=${rate.num}/${rate.den}`,
      `scale=${width}:-2`,
    ];
    // VideoToolbox on a Mac, libopenh264 and software decode on Linux (h264-route.ts).
    const route = await h264Route(ctx.binaries.ffmpeg);
    const run = await runFfmpeg(
      ctx,
      [
        '-y',
        ...route.decode,
        '-i',
        path,
        '-vf',
        filters.join(','),
        '-c:v',
        route.encoder,
        '-b:v',
        '6M',
        '-c:a',
        'aac',
        outPath,
      ],
      { signal },
    );
    if (!run.ok) return run;
    const frames = await countFrames(ctx, outPath, signal);
    return frames.ok ? ok({ path: outPath, frames: frames.value }) : frames;
  };

export const extractFrames =
  (ctx: MediaContext): BreakdownMedia['extractFrames'] =>
  async (path, frames, { maxDimension, outDir, signal }) => {
    await mkdir(outDir, { recursive: true });
    const sorted = [...new Set(frames)].sort((a, b) => a - b);
    if (sorted.length === 0) return ok([]);
    const work = join(outDir, `.batch-${process.pid}-${Date.now()}`);
    await mkdir(work);
    // Any number of frames: a flat eq() sum fails past 100 (FFmpeg's parser depth, EAR1-G3).
    const select = framesExpression(sorted);
    const run = await runFfmpeg(
      ctx,
      [
        '-i',
        path,
        '-vf',
        `select='${select}',scale=w=${maxDimension}:h=${maxDimension}:force_original_aspect_ratio=decrease`,
        '-fps_mode',
        'passthrough',
        '-q:v',
        '3',
        join(work, '%06d.jpg'),
      ],
      { signal },
    );
    if (!run.ok) return run;
    const written = (await readdir(work)).sort();
    if (written.length !== sorted.length) return fail(`asked ${sorted.length} frames, got ${written.length}`);
    const byFrame = new Map<number, string>();
    for (const [index, name] of written.entries()) {
      const frame = sorted[index]!;
      const target = join(outDir, `frame-${String(frame).padStart(6, '0')}.jpg`);
      await rename(join(work, name), target);
      byFrame.set(frame, target);
    }
    await rm(work, { recursive: true, force: true });
    return ok(frames.map((frame) => byFrame.get(frame)!));
  };

export const contactSheet =
  (ctx: MediaContext): BreakdownMedia['contactSheet'] =>
  async (images, layout, { outPath, signal }) => {
    const work = `${outPath}.tiles`;
    await mkdir(work, { recursive: true });
    await Promise.all(
      images.map((image, index) => symlink(image, join(work, `${String(index + 1).padStart(4, '0')}.jpg`))),
    );
    const { tileWidth: w, tileHeight: h } = layout;
    const quality = Math.max(2, Math.min(31, Math.round((100 - layout.quality) / 6)));
    const run = await runFfmpeg(
      ctx,
      [
        '-y',
        '-framerate',
        '1',
        '-i',
        join(work, '%04d.jpg'),
        '-vf',
        `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,tile=${layout.columns}x${layout.rows}`,
        '-frames:v',
        '1',
        '-q:v',
        String(quality),
        outPath,
      ],
      { signal },
    );
    await rm(work, { recursive: true, force: true });
    if (!run.ok) return run;
    return ok({ path: outPath, bytes: (await stat(outPath)).size });
  };

export const lumaCurve =
  (ctx: MediaContext): NonNullable<BreakdownMedia['lumaCurve']> =>
  async (path, { rate, ranges, signal }) => {
    if (ranges.length === 0) return ok([]);
    // Any number of ranges: a flat between() sum fails past 100 (FFmpeg's parser depth, EAR1-G3).
    const select = rangesExpression(ranges.map(([start, end]) => ({ first: start, last: end - 1 })));
    const run = await runFfmpeg(
      ctx,
      [
        '-i',
        path,
        '-vf',
        `select='${select}',signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
        '-an',
        '-f',
        'null',
        '-',
      ],
      { signal, maxStdoutBytes: 64 * 1024 * 1024 },
    );
    if (!run.ok) return run;
    const values: { frame: number; luma: number }[] = [];
    let frame = -1;
    for (const line of run.value.stdout.toString('utf8').split('\n')) {
      // After select, the filter's own frame count isn't the reel's: go by time.
      const time = /pts_time:([\d.]+)/.exec(line);
      if (time) frame = Math.round((Number(time[1]) * rate.num) / rate.den);
      const yavg = /YAVG=([\d.]+)/.exec(line);
      if (yavg && frame >= 0) values.push({ frame, luma: Number(yavg[1]) / 255 });
    }
    return ok(values);
  };
