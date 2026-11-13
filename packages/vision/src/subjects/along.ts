// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A shot's subjects without the mac helper (FRM1-SUB): its frames at `detectHz`, decoded upright at `shortSide` on
 * the short edge, each through the ONNX detector and `headsFrom`, as core's subject samples (all `detect`: nothing
 * tracks between them). Frames are decoded and detected in chunks, so a long shot's memory stays flat. The subject
 * of each sample is chosen as the helper chooses it (choose.ts), seeded by the one before.
 */
import {
  CancelledError,
  err,
  ok,
  RationalTime,
  type AsyncResult,
  type SubjectSample,
  type TimeRange,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { fitLongSide, probeSource, sampleFrames } from '../media/frames';
import { chooseSubject } from './choose';
import type { SubjectDetector } from './detector';
import { headsFrom } from './heads';

export interface SubjectsAlongInput {
  readonly path: string;
  /** The shot, at the asset's rate (the samples' times are at it too). */
  readonly range: TimeRange;
  readonly detectHz: number;
  readonly shortSide: number;
  readonly signal?: AbortSignal;
}

export interface SubjectsAlong {
  /** The decoded upright frame the boxes are fractions of. */
  readonly frame: { readonly width: number; readonly height: number };
  readonly samples: SubjectSample[];
}

/** Frames decoded and detected together. */
const CHUNK = 16;

/** The grid frames at `detectHz` from the range's start up to (not including) its end. */
export function detectFrames(
  range: { readonly startSeconds: number; readonly endSeconds: number },
  fps: number,
  detectHz: number,
  frameCount: number,
): number[] {
  const frames: number[] = [];
  const step = 1 / detectHz;
  for (let k = 0; ; k += 1) {
    const seconds = range.startSeconds + k * step;
    if (seconds >= range.endSeconds - 1e-9) break;
    const frame = Math.min(frameCount - 1, Math.max(0, Math.round(seconds * fps)));
    if (frames[frames.length - 1] !== frame) frames.push(frame);
  }
  return frames;
}

export async function detectSubjectsAlong(
  input: SubjectsAlongInput,
  deps: { readonly media: MediaContext; readonly detector: SubjectDetector },
): AsyncResult<SubjectsAlong> {
  const source = await probeSource(deps.media, input.path, input.signal);
  if (!source.ok) return source;
  const { width, height } = source.value;
  const short = Math.min(width, height);
  const size = fitLongSide(
    width,
    height,
    Math.round((input.shortSide / Math.max(1, short)) * Math.max(width, height)),
  );
  const fps = source.value.rate.num / source.value.rate.den;
  const startSeconds = RationalTime.toSeconds(input.range.start);
  const endSeconds = startSeconds + RationalTime.toSeconds(input.range.duration);
  const frames = detectFrames(
    { startSeconds, endSeconds },
    fps,
    input.detectHz,
    source.value.frameCount ?? Number.MAX_SAFE_INTEGER,
  );
  const rate = input.range.start.rate;
  const samples: SubjectSample[] = [];
  let previous: SubjectSample['subject']['box'] = null;
  for (let at = 0; at < frames.length; at += CHUNK) {
    if (input.signal?.aborted) return err(CancelledError());
    const chunk = await sampleFrames(deps.media, source.value, {
      size,
      format: 'rgb24',
      frames: frames.slice(at, at + CHUNK),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!chunk.ok) return chunk;
    for (const frame of chunk.value) {
      const found = await deps.detector.detect(
        { rgb: frame.data, width: frame.width, height: frame.height },
        input.signal,
      );
      if (!found.ok) return found;
      const { heads, people } = headsFrom(found.value, frame);
      const faces = found.value.faces.slice(0, 16);
      const humans = found.value.people.slice(0, 16);
      const subject = chooseSubject(faces, humans, previous);
      previous = subject.box;
      // A frame's time at the source's grid, at the asset's rate; inside the range by construction.
      const t = RationalTime.fromSeconds(frame.index / fps, rate);
      samples.push({
        t,
        source: 'detect',
        faces: faces.map((face) => ({
          box: face.box,
          confidence: face.confidence,
          roll: 0,
          yaw: face.yaw ?? 0,
          pitch: 0,
        })),
        humans: humans.map((person) => ({ box: person.box, confidence: person.confidence })),
        saliency: [],
        heads: heads.slice(0, 16),
        people: people.slice(0, 16),
        subject: {
          kind: subject.kind,
          box: subject.box,
          focus: subject.focus,
          confidence: subject.confidence,
        },
      });
    }
  }
  return ok({ frame: size, samples });
}
