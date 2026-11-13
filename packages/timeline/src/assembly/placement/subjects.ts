// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where people are on the made canvas (FRM1-OVL): each V1 clip's subject span (FRM1-SUB's SubjectSource: boxes
 * as fractions of the clip's upright frame, at source times) placed on the timeline's frames through the clip's
 * speed and on the canvas through its fit: a centre crop for `cover`, bars for `contain`, and for a reframed clip
 * the crop render follows the subject with, estimated here at the span's median subject point (render's own path
 * is smoothed; its graphics layout and QA read the exact one). A detect sample's heads are the hard keep-out; an
 * old track without heads stands its faces and bodies in for them, grown to a whole head. Pure.
 */
import {
  RationalTime,
  silhouetteCells,
  silhouetteShare,
  type Clip,
  type Silhouette,
  type SubjectSample,
  type SubjectSpan,
  type Timeline,
} from '@taalcut/core';
import { layoutBoxOnCanvas, layoutCropAt } from '../../model/visual-layout';
import { positions, videoItems } from '../../model/sequence';
import { sourceFrames } from '../../model/speed';
import { spansOverlap, type Rect, type Size, type Span } from './geometry';
import type { SceneFrame } from './types';

type Box = Rect;

/** A clip on V1 with its frames on the timeline and the frames it is seen in (through a transition too). */
export interface PlacedClip {
  readonly clip: Clip;
  readonly start: number;
  readonly end: number;
  readonly seen: Span;
}

export function placedClips(timeline: Timeline): PlacedClip[] {
  const items = videoItems(timeline);
  return positions(items).flatMap((position) => {
    if (position.item.type !== 'clip') return [];
    const before = items[position.itemIndex - 1];
    const after = items[position.itemIndex + 1];
    // A transition shows both clips: the incoming one from inOffset before the cut, the outgoing one past it.
    const early = before?.type === 'transition' ? before.inOffset.value : 0;
    const late = after?.type === 'transition' ? after.outOffset.value : 0;
    return [
      {
        clip: position.item,
        start: position.start,
        end: position.end,
        seen: { start: position.start - early, end: position.end + late },
      },
    ];
  });
}

/** The source range a clip plays, at its media's rate: [sourceStart, sourceStart + what it consumes). */
export function clipSourceRange(clip: Clip, canvasRate: Timeline['canvas']['rate']) {
  const rate = clip.media.kind === 'image' ? clip.sourceStart.rate : clip.media.available.start.rate;
  const seconds = sourceFrames(clip.speed, clip.duration.value) / (canvasRate.num / canvasRate.den);
  const start = RationalTime.rescale(clip.sourceStart, rate, 'floor');
  return { start, end: RationalTime.add(start, RationalTime.fromSeconds(seconds, rate, 'ceil')) };
}

/** The timeline frame (fractional) a source time plays at in a clip, through its speed. */
function frameOf(placed: PlacedClip, t: RationalTime, fps: number): number {
  const local = (RationalTime.toSeconds(t) - RationalTime.toSeconds(placed.clip.sourceStart)) * fps;
  if (!placed.clip.speed) return placed.start + local;
  let low = -placed.clip.duration.value;
  let high = 2 * placed.clip.duration.value;
  for (let step = 0; step < 40; step++) {
    const mid = (low + high) / 2;
    if (sourceFrames(placed.clip.speed, mid) < local) low = mid;
    else high = mid;
  }
  return placed.start + (low + high) / 2;
}

/** A head grown from a face (Vision's face box runs brow to chin): the hair above it and the ears beside it. */
const headOfFace = (face: Box): Box => ({
  x: face.x - 0.25 * face.width,
  y: face.y - 0.55 * face.height,
  width: 1.5 * face.width,
  height: 1.7 * face.height,
});

/** The top of a body seen from behind or too small for a face: its head, as a share of its width and height. */
const headOfBody = (body: Box, aspect: number): Box => {
  const width = 0.55 * body.width;
  const height = Math.min(0.3 * body.height, width * aspect * 1.3);
  return { x: body.x + (body.width - width) / 2, y: body.y, width, height };
};

const contains = (outer: Box, inner: Box) =>
  inner.x + inner.width / 2 >= outer.x &&
  inner.x + inner.width / 2 <= outer.x + outer.width &&
  inner.y + inner.height / 2 >= outer.y &&
  inner.y + inner.height / 2 <= outer.y + outer.height;

/** A sample's heads in source fractions: its own when the track measured them, else stood in from faces and bodies. */
export function headsOf(sample: SubjectSample, aspect: number): Box[] {
  if (sample.heads) return sample.heads.map((entry) => entry.box);
  const faces = sample.faces.map((face) => headOfFace(face.box));
  const bodies = sample.humans
    .map((human) => human.box)
    .filter((body) => !sample.faces.some((face) => contains(body, face.box)))
    .map((body) => headOfBody(body, aspect));
  return [...faces, ...bodies];
}

/** How a clip's upright frame lies on the canvas: its scale and offset, in canvas pixels. */
export interface FrameOnCanvas {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0.5 : sorted[Math.floor(sorted.length / 2)]!;
};

/** The point a reframed clip's crop follows: the subject's, else the heads' middle, else the centre. */
function focusOf(samples: readonly SubjectSample[], aspect: number): { x: number; y: number } {
  const points = samples.flatMap((sample) => {
    if (sample.subject.focus) return [sample.subject.focus];
    const heads = headsOf(sample, aspect);
    return heads.length > 0
      ? [{ x: median(heads.map((h) => h.x + h.width / 2)), y: median(heads.map((h) => h.y + h.height / 2)) }]
      : [];
  });
  return { x: median(points.map((p) => p.x)), y: median(points.map((p) => p.y)) };
}

export function frameOnCanvas(
  clip: Clip,
  source: Size,
  canvas: Size,
  samples: readonly SubjectSample[],
): FrameOnCanvas {
  const mode = clip.reframe?.mode ?? null;
  const contain = mode === 'blurPad' || (mode === null && clip.fit === 'contain');
  const base = contain
    ? Math.min(canvas.width / source.width, canvas.height / source.height)
    : Math.max(canvas.width / source.width, canvas.height / source.height);
  const punch = mode === 'blurPad' ? 1 : (clip.reframe?.scale ?? 1);
  const scale = base * punch;
  const width = source.width * scale;
  const height = source.height * scale;
  const follows = mode === 'auto' || mode === 'subject';
  const focus = follows ? focusOf(samples, source.height / source.width) : { x: 0.5, y: 0.5 };
  const nudge = clip.reframe?.nudge ?? { x: 0, y: 0 };
  const place = (size: number, room: number, at: number, by: number) => {
    if (size <= room) return (room - size) / 2;
    const wanted = room / 2 - at * size + by * room;
    return Math.min(0, Math.max(room - size, wanted));
  };
  return {
    scale,
    width,
    height,
    x: place(width, canvas.width, focus.x, nudge.x),
    y: place(height, canvas.height, focus.y, nudge.y),
  };
}

const onCanvas = (box: Box, frame: FrameOnCanvas): Box => ({
  x: frame.x + box.x * frame.width,
  y: frame.y + box.y * frame.height,
  width: box.width * frame.width,
  height: box.height * frame.height,
});

function silhouetteOn(grid: Silhouette, frame: FrameOnCanvas): (rect: Rect) => number {
  const cells = silhouetteCells(grid);
  return (rect) =>
    silhouetteShare(
      grid,
      {
        x: (rect.x - frame.x) / frame.width,
        y: (rect.y - frame.y) / frame.height,
        width: rect.width / frame.width,
        height: rect.height / frame.height,
      },
      cells,
    );
}

/**
 * The scene frames of every clip, in time order: one per sample that measured people (detect samples; every
 * sample of an old track), at the timeline frame it plays, inside the frames its clip is seen in.
 */
export function sceneFramesOf(
  clips: readonly { readonly placed: PlacedClip; readonly span: SubjectSpan | undefined }[],
  canvas: Size,
  fps: number,
): SceneFrame[] {
  const out: SceneFrame[] = [];
  for (const { placed, span } of clips) {
    if (!span || span.samples.length === 0) continue;
    // Without the frame's size (a track from before FRM1), the source is taken to fill the canvas as it is.
    const source = span.frame ?? canvas;
    const aspect = source.height / source.width;
    const measured = span.samples.some((sample) => sample.heads !== undefined);
    const samples = measured ? span.samples.filter((sample) => sample.heads !== undefined) : span.samples;
    const frame = frameOnCanvas(placed.clip, source, canvas, samples);
    const margin = Math.ceil(fps / 4);
    for (const sample of samples) {
      const at = frameOf(placed, sample.t, fps);
      if (at < placed.seen.start - margin || at >= placed.seen.end + margin) continue;
      const layout = placed.clip.visualLayout;
      const mapBoxes = (boxes: readonly Box[]) =>
        layout
          ? boxes.flatMap((box) =>
              layout.regions.flatMap((region) => {
                const mapped = layoutBoxOnCanvas(
                  box,
                  region,
                  layoutCropAt(region, RationalTime.toSeconds(sample.t)),
                  source,
                  canvas,
                );
                return mapped ? [mapped] : [];
              }),
            )
          : boxes.map((box) => onCanvas(box, frame));
      const people = mapBoxes((sample.people ?? sample.humans).map((entry) => entry.box));
      out.push({
        frame: Math.min(placed.seen.end - 1, Math.max(placed.seen.start, Math.round(at))),
        heads: mapBoxes(headsOf(sample, aspect)),
        people,
        salient: mapBoxes(sample.saliency.map((entry) => entry.box)),
        ...(!layout && sample.silhouette ? { silhouette: silhouetteOn(sample.silhouette, frame) } : {}),
        visible: placed.seen,
      });
    }
  }
  return out.sort((a, b) => a.frame - b.frame);
}

/** The frames over a span, with one detect step's margin either side, from clips on screen during it. */
export function framesDuring(frames: readonly SceneFrame[], span: Span, fps: number): SceneFrame[] {
  const margin = Math.ceil(fps / 4);
  return frames.filter(
    (frame) =>
      frame.frame >= span.start - margin &&
      frame.frame < span.end + margin &&
      (!frame.visible || spansOverlap(frame.visible, span)),
  );
}
