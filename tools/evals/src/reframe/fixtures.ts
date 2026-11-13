// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Synthetic subject tracks: boxes with a known path, no media. Scorer tests use the JSON cases; predict runs
 * planVisualFraming on the labels.
 */
import { join } from 'node:path';
import { writeJson } from '../files';
import type { ReframeClipLabel, ReframePrediction } from './schema';

export const REFRAME_SOURCE = { width: 1920, height: 1080 };
export const REFRAME_CANVAS = { width: 1080, height: 1920 };
export const REFRAME_FPS = 30;
export const REFRAME_FRAMES = 150;

interface FractionBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function pixels(box: FractionBox): { x: number; y: number; w: number; h: number } {
  return {
    x: box.x * REFRAME_SOURCE.width,
    y: box.y * REFRAME_SOURCE.height,
    w: box.width * REFRAME_SOURCE.width,
    h: box.height * REFRAME_SOURCE.height,
  };
}

/** Face walking left to right, the same path render's framing test keeps in frame. */
export function walkingFace(seconds: number): { face: FractionBox; human: FractionBox } {
  return {
    face: { x: 0.2 + 0.1 * seconds, y: 0.25, width: 0.08, height: 0.14 },
    human: { x: 0.18 + 0.1 * seconds, y: 0.2, width: 0.12, height: 0.7 },
  };
}

/** Labelled frames at 4 fps over the 5 s clip. */
export function labelledFrames(): number[] {
  const frames: number[] = [];
  for (let index = 0; index < 20; index += 1) {
    const frame = Math.round((index * REFRAME_FPS) / 4);
    if (frame < REFRAME_FRAMES) frames.push(frame);
  }
  return frames;
}

export function heldClip(): ReframeClipLabel {
  return {
    clipId: 'held',
    synthetic: true,
    fps: REFRAME_FPS,
    frames: REFRAME_FRAMES,
    source: REFRAME_SOURCE,
    canvas: REFRAME_CANVAS,
    samples: labelledFrames().map((tFrame) => ({
      tFrame,
      ...pixels(walkingFace(tFrame / REFRAME_FPS).face),
    })),
  };
}

export function emptyClip(): ReframeClipLabel {
  return {
    clipId: 'empty',
    synthetic: true,
    fps: REFRAME_FPS,
    frames: 60,
    source: REFRAME_SOURCE,
    canvas: REFRAME_CANVAS,
    samples: [0, 8, 15, 23, 30, 38, 45, 53].map((tFrame) => ({ tFrame })),
  };
}

export function plannerLabels(): ReframeClipLabel[] {
  return [heldClip(), emptyClip()];
}

/**
 * Ten labelled frames. Eight sit in the crop; two are outside it. Share 8/10 = 0.8.
 * The crop does not move, so the speed check contributes no jitter.
 */
export function driftCase(): { label: ReframeClipLabel; prediction: ReframePrediction } {
  const crop = { x: 400, y: 0, w: 600, h: 1080 };
  const inside = { x: 450, y: 400, w: 100, h: 100 };
  const outside = { x: 0, y: 0, w: 100, h: 100 };
  const samples = Array.from({ length: 10 }, (_, tFrame) => ({
    tFrame,
    ...(tFrame < 8 ? inside : outside),
  }));
  return {
    label: {
      clipId: 'drift',
      synthetic: true,
      fps: REFRAME_FPS,
      frames: 10,
      source: REFRAME_SOURCE,
      canvas: REFRAME_CANVAS,
      samples,
    },
    prediction: {
      clipId: 'drift',
      framing: 'subject',
      crops: samples.map((sample) => ({ tFrame: sample.tFrame, ...crop })),
      centres: Array.from({ length: 10 }, () => ({
        x: crop.x + crop.w / 2,
        y: crop.y + crop.h / 2,
        w: crop.w,
        h: crop.h,
      })),
      qaJitterFrames: [],
    },
  };
}

export function writeReframeFixtures(dir: string): { labels: string } {
  writeJson(join(dir, 'clips.json'), plannerLabels());
  return { labels: dir };
}
