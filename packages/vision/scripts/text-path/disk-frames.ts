// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The OCR frames of bench jobs on disk (IX3-O1 study): each job's samples (the one-second grid and the best
 * frames of shots with no grid frame) decoded once at the OCR size, one raw rgb24 file per frame, so the
 * experiments time reading and not decoding. The frame source over them answers what `readShotText` asks
 * (`video`, `frames`); a study has no pass, so `pass` and `prefetch` answer with an error.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { err, ok, RationalTime, UnknownError, type AsyncResult } from '@taalcut/core';
import { NO_DECODES, type MediaContext } from '@taalcut/media';
import { z } from 'zod';
import { ocrSampling } from '../../src/analysis/frame-pass';
import { visionReadShotTextJob, type ReadShotTextInput } from '../../src/jobs/ocr-kinds';
import type { FrameRequest, FrameSource } from '../../src/media/frame-source';
import { sampleFrames, videoSourceOf, type SampledFrame, type VideoSource } from '../../src/media/frames';
import { shotSamples } from '../../src/ocr/read-shots';

/** The bench library's `vision.readShotText` payloads, parsed by the job kind's own input schema. */
export function parseJobs(json: unknown): ReadShotTextInput[] {
  return z.array(visionReadShotTextJob.input).parse(json);
}

/** The job's video source, from the plan its payload carries (no probe). */
export function sourceOf(job: ReadShotTextInput): VideoSource {
  if (!job.plan) throw new Error(`${job.path}: the payload has no plan`);
  return videoSourceOf(job.path, job.plan);
}

/** Every frame the job's read asks for: the grid samples of each shot, or its best (else middle) frame. */
function samplesOf(job: ReadShotTextInput, video: VideoSource, every: number): number[] {
  const frames = new Set<number>();
  for (const shot of job.shots) {
    const start = RationalTime.toFrames(shot.range.start, video.rate);
    const end = start + Math.max(1, RationalTime.toFrames(shot.range.duration, video.rate));
    const best = shot.bestFrame === undefined ? undefined : start + Math.min(end - start - 1, shot.bestFrame);
    for (const f of shotSamples({ start, end, ...(best !== undefined ? { bestFrame: best } : {}) }, every))
      frames.add(f);
  }
  return [...frames].sort((a, b) => a - b);
}

const metaSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frames: z.array(z.number().int().nonnegative()),
});

/** Decodes the job's samples (FFmpeg, one-thread conversion as the app's) into `dir/<file>/`. */
export async function prepareJob(media: MediaContext, job: ReadShotTextInput, dir: string): Promise<number> {
  const video = sourceOf(job);
  const { size, every } = ocrSampling(studySource(video, async () => ok([])));
  const wanted = samplesOf(job, video, every);
  const sampled = await sampleFrames(media, video, { size, format: 'rgb24', frames: wanted });
  if (!sampled.ok) throw new Error(`decode ${job.path}: ${sampled.error.code} ${sampled.error.detail ?? ''}`);
  const target = join(dir, basename(job.path));
  await mkdir(target, { recursive: true });
  for (const frame of sampled.value) await writeFile(join(target, `${frame.index}.rgb`), frame.data);
  const meta = { width: size.width, height: size.height, frames: sampled.value.map((f) => f.index) };
  await writeFile(join(target, 'meta.json'), JSON.stringify(meta));
  return sampled.value.length;
}

/** The frames the job's folder holds. */
export async function storedFrames(job: ReadShotTextInput, dir: string): Promise<z.infer<typeof metaSchema>> {
  return metaSchema.parse(JSON.parse(await readFile(join(dir, basename(job.path), 'meta.json'), 'utf8')));
}

export interface TimedSource {
  readonly source: FrameSource;
  /** Time spent in `frames` (reading the files) so far. */
  readMs(): number;
}

const noPass = () => err(UnknownError(undefined, { detail: 'the study reads frames from disk only' }));

/** A frame source over `dir/<file>/`: reads are timed, as the app's frame cache reads would be. */
export async function diskFrameSource(job: ReadShotTextInput, dir: string): Promise<TimedSource> {
  const folder = join(dir, basename(job.path));
  const meta = await storedFrames(job, dir);
  const stored = new Set(meta.frames);
  let readMs = 0;
  const frames = async (request: FrameRequest): AsyncResult<SampledFrame[]> => {
    const started = performance.now();
    const out: SampledFrame[] = [];
    for (const index of [...request.frames].sort((a, b) => a - b)) {
      if (!stored.has(index)) continue;
      const data = new Uint8Array(await readFile(join(folder, `${index}.rgb`)));
      out.push({ index, width: meta.width, height: meta.height, data });
    }
    readMs += performance.now() - started;
    return ok(out);
  };
  return { source: studySource(sourceOf(job), frames), readMs: () => readMs };
}

/** A frame source that answers `frames` with `frames` and has no pass, documents or decodes. */
function studySource(video: VideoSource, frames: FrameSource['frames']): FrameSource {
  return {
    video,
    input: 'original',
    frames,
    prefetch: async () => noPass(),
    pass: async () => noPass(),
    putDoc: async () => ok(false),
    getDoc: async () => ok(undefined),
    expect: () => undefined,
    release: async () => undefined,
    decodes: () => NO_DECODES,
    close: async () => undefined,
  };
}
