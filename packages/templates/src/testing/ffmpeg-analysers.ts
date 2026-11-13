// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stand-in analysers on the bundled FFmpeg, for the integration test and the
 * synthetic eval until the vision lane's functions land. Method A is real
 * (scdet). Method B's "embedding" is a 12×12 colour thumbnail centred on mid
 * grey, NOT EmbeddingGemma: synthetic numbers measured with it say so. Beats
 * are click onsets (silencedetect), loudness is ebur128. No OCR: text needs
 * the mac helper, which these stand-ins don't have.
 */
import { mkdir, readdir, rename, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  FrameRate,
  ok,
  RationalTime,
  UnknownError,
  type AsyncResult,
  type BeatMap,
} from '@taalcut/core';
import type { BreakdownAnalysers, ReferenceProbe } from '../breakdown/ports';
import { ffmpegFramePixels } from './ffmpeg-pixels';
import { runProcess } from './run-process';

export interface FfmpegBinaryPaths {
  readonly ffmpeg: string;
  readonly ffprobe: string;
}

const THUMB = 12;
const BEAT_RATE = FrameRate.of(100);

interface ProbeJson {
  streams?: {
    codec_type?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    avg_frame_rate?: string;
  }[];
  format?: { duration?: string };
}

const fail = (detail: string) => err(UnknownError(undefined, { detail }));

/**
 * The normalise step's decode and encode: media's choices when the caller has them (`hwaccel`: the machine's
 * hw-video row's, `encoder`: `selectWorkingEncoder`'s), else VideoToolbox both ways on a Mac and the CPU elsewhere.
 */
export interface FfmpegAnalyserVideo {
  readonly hwaccel?: string | null;
  readonly encoder?: string;
}

const DEFAULT_VIDEO: Required<FfmpegAnalyserVideo> =
  process.platform === 'darwin'
    ? { hwaccel: 'videotoolbox', encoder: 'h264_videotoolbox' }
    : { hwaccel: null, encoder: 'libopenh264' };

export function createFfmpegAnalysers(
  bins: FfmpegBinaryPaths,
  video: FfmpegAnalyserVideo = {},
): BreakdownAnalysers {
  const hwaccel = video.hwaccel === undefined ? DEFAULT_VIDEO.hwaccel : video.hwaccel;
  const encoder = video.encoder ?? DEFAULT_VIDEO.encoder;
  const thumbs = new Map<string, Float32Array[]>();

  async function probe(path: string, signal: AbortSignal): AsyncResult<ReferenceProbe> {
    const run = await runProcess(
      bins.ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path],
      signal,
    );
    if (!run.ok) return run;
    const json = JSON.parse(run.value.stdout.toString('utf8')) as ProbeJson;
    const video = json.streams?.find((stream) => stream.codec_type === 'video');
    const rate = FrameRate.parse(video?.r_frame_rate ?? video?.avg_frame_rate ?? '30/1');
    if (!rate.ok) return rate;
    const seconds = Number(json.format?.duration ?? '0');
    return ok({
      duration: RationalTime.fromSeconds(seconds, rate.value),
      rate: rate.value,
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      hasVideo: Boolean(video),
      hasAudio: Boolean(json.streams?.some((stream) => stream.codec_type === 'audio')),
    });
  }

  async function allThumbs(path: string, signal: AbortSignal): AsyncResult<Float32Array[]> {
    const cached = thumbs.get(path);
    if (cached) return ok(cached);
    const run = await runProcess(
      bins.ffmpeg,
      [
        '-v',
        'error',
        '-i',
        path,
        '-vf',
        `scale=${THUMB}:${THUMB}:flags=area,format=rgb24`,
        '-f',
        'rawvideo',
        '-',
      ],
      signal,
    );
    if (!run.ok) return run;
    const size = THUMB * THUMB * 3;
    const frames: Float32Array[] = [];
    // Each channel value is an angle (0 to π), written as its cosine and sine: every vector has the same
    // length, and the cosine distance is the mean of 1 − cos(π·Δ) over the thumbnail, a smooth picture change.
    for (let offset = 0; offset + size <= run.value.stdout.length; offset += size) {
      const vector = new Float32Array(size * 2);
      for (let i = 0; i < size; i++) {
        const angle = (run.value.stdout[offset + i]! / 255) * Math.PI;
        vector[2 * i] = Math.cos(angle);
        vector[2 * i + 1] = Math.sin(angle);
      }
      frames.push(vector);
    }
    thumbs.set(path, frames);
    return ok(frames);
  }

  async function extract(
    path: string,
    frames: readonly number[],
    maxDimension: number,
    outDir: string,
    signal: AbortSignal,
  ) {
    await mkdir(outDir, { recursive: true });
    const sorted = [...new Set(frames)].sort((a, b) => a - b);
    const work = join(outDir, `.batch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(work);
    const select = sorted.map((frame) => `eq(n,${frame})`).join('+');
    const run = await runProcess(
      bins.ffmpeg,
      [
        '-v',
        'error',
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
      signal,
    );
    if (!run.ok) return run;
    const written = (await readdir(work)).sort();
    if (written.length !== sorted.length) return fail(`asked ${sorted.length} frames, got ${written.length}`);
    const byFrame = new Map<number, string>();
    for (const [index, name] of written.entries()) {
      const target = join(outDir, `frame-${String(sorted[index]).padStart(6, '0')}.jpg`);
      await rename(join(work, name), target);
      byFrame.set(sorted[index]!, target);
    }
    await rm(work, { recursive: true, force: true });
    return ok(frames.map((frame) => byFrame.get(frame)!));
  }

  return {
    media: {
      probe: (path, { signal }) => probe(path, signal),
      async normalise(path, { outPath, rate, width, crop, signal }) {
        const filters = [
          ...(crop ? [`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`] : []),
          `fps=${rate.num}/${rate.den}`,
          `scale=${width}:-2`,
        ];
        const run = await runProcess(
          bins.ffmpeg,
          [
            '-v',
            'error',
            '-y',
            ...(hwaccel ? ['-hwaccel', hwaccel] : []),
            '-i',
            path,
            '-vf',
            filters.join(','),
            '-c:v',
            encoder,
            '-b:v',
            '4M',
            '-c:a',
            'aac',
            outPath,
          ],
          signal,
        );
        if (!run.ok) return run;
        const counted = await runProcess(
          bins.ffprobe,
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
            outPath,
          ],
          signal,
        );
        if (!counted.ok) return counted;
        return ok({ path: outPath, frames: Number(counted.value.stdout.toString('utf8').trim()) });
      },
      extractFrames: (path, frames, { maxDimension, outDir, signal }) =>
        extract(path, frames, maxDimension, outDir, signal),
      framePixels: ffmpegFramePixels(bins),
      async contactSheet(images, layout, { outPath, signal }) {
        const work = `${outPath}.tiles`;
        await mkdir(work, { recursive: true });
        await Promise.all(
          images.map((image, index) =>
            symlink(image, join(work, `${String(index + 1).padStart(4, '0')}.jpg`)),
          ),
        );
        const { tileWidth: w, tileHeight: h } = layout;
        const quality = Math.max(2, Math.min(31, Math.round((100 - layout.quality) / 6)));
        const run = await runProcess(
          bins.ffmpeg,
          [
            '-v',
            'error',
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
          signal,
        );
        await rm(work, { recursive: true, force: true });
        if (!run.ok) return run;
        return ok({ path: outPath, bytes: (await stat(outPath)).size });
      },
      async lumaCurve(path, { rate, ranges, signal }) {
        const select = ranges.map(([start, end]) => `between(n,${start},${end - 1})`).join('+');
        const run = await runProcess(
          bins.ffmpeg,
          [
            '-v',
            'error',
            '-i',
            path,
            '-vf',
            `select='${select}',signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
            '-an',
            '-f',
            'null',
            '-',
          ],
          signal,
        );
        if (!run.ok) return run;
        const lines = run.value.stdout.toString('utf8').split('\n');
        const values: { frame: number; luma: number }[] = [];
        let frame = -1;
        for (const line of lines) {
          // After select, the filter's own frame count isn't the reel's: go by time.
          const time = /pts_time:([\d.]+)/.exec(line);
          if (time) frame = Math.round((Number(time[1]) * rate.num) / rate.den);
          const yavg = /YAVG=([\d.]+)/.exec(line);
          if (yavg && frame >= 0) values.push({ frame, luma: Number(yavg[1]) / 255 });
        }
        return ok(values);
      },
    },
    vision: {
      async sceneScores(path, { signal }) {
        const run = await runProcess(
          bins.ffmpeg,
          [
            '-v',
            'error',
            '-i',
            path,
            '-vf',
            'scale=256:-2,scdet=threshold=100:sc_pass=0,metadata=print:file=-',
            '-an',
            '-f',
            'null',
            '-',
          ],
          signal,
        );
        if (!run.ok) return run;
        const scores: number[] = [];
        let frame = -1;
        for (const line of run.value.stdout.toString('utf8').split('\n')) {
          const head = /^frame:\s*(\d+)/.exec(line);
          if (head) frame = Number(head[1]);
          const score = /lavfi\.scd\.score=([\d.]+)/.exec(line);
          if (score && frame >= 0) scores[frame] = Number(score[1]);
        }
        return ok(Array.from(scores, (score) => score ?? 0));
      },
      async frameEmbeddings(path, frames, { signal }) {
        const all = await allThumbs(path, signal);
        if (!all.ok) return all;
        return ok(frames.map((frame) => all.value[Math.min(frame, all.value.length - 1)]!));
      },
    },
    audio: {
      async beats(path, { signal }) {
        const run = await runProcess(
          bins.ffmpeg,
          [
            '-v',
            'info',
            '-hide_banner',
            '-i',
            path,
            '-vn',
            '-af',
            'silencedetect=n=-40dB:d=0.05',
            '-f',
            'null',
            '-',
          ],
          signal,
        );
        if (!run.ok) return run;
        const onsets = [...run.value.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((match) =>
          Number(match[1]),
        );
        const starts = [...run.value.stderr.matchAll(/silence_start: ([\d.]+)/g)].map((match) =>
          Number(match[1]),
        );
        // A click at 0 has no silence before it.
        if (starts[0] !== undefined && starts[0] > 0 && starts[0] < 0.05) onsets.unshift(0);
        const ticks = [...new Set(onsets.map((t) => Math.round(t * 100)))].sort((a, b) => a - b);
        if (ticks.length < 2) return ok({ beatMap: null });
        const gaps = ticks
          .slice(1)
          .map((t, i) => t - ticks[i]!)
          .sort((a, b) => a - b);
        const beatMap: BeatMap = {
          rate: BEAT_RATE,
          beats: ticks.map((t) => RationalTime.of(t, BEAT_RATE)),
          downbeats: ticks.map((_, i) => i).filter((i) => i % 4 === 0),
          bpm: Math.round(6000 / gaps[gaps.length >> 1]!),
          beatsPerBar: 4,
          confidence: 1,
          source: 'tracker',
        };
        return ok({ beatMap });
      },
      async loudness(path, { signal }) {
        const run = await runProcess(
          bins.ffmpeg,
          ['-v', 'info', '-hide_banner', '-i', path, '-vn', '-af', 'ebur128', '-f', 'null', '-'],
          signal,
        );
        if (!run.ok) return run;
        const integrated = [...run.value.stderr.matchAll(/I:\s+(-?[\d.]+|-inf) LUFS/g)].at(-1)?.[1];
        const value = integrated === undefined || integrated === '-inf' ? null : Number(integrated);
        return ok({ integratedLufs: value });
      },
    },
  };
}
