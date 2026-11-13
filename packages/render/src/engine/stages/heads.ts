// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where people's heads are on the canvas (FRM1-OVL), for every video clip of the render, not only the reframed
 * ones: each clip's subject track (stored; the export tracks a missing one, a preview never does), its detect
 * samples placed on the output frames through the clip's speed, and on the canvas through what the clip shows
 * there (its crop path when reframed, its centre crop or bars otherwise). QA's graphicCoversFace checks every text
 * item against them. A clip
 * without a track has no heads: QA says how many clips it couldn't see.
 */
import {
  ok,
  RationalTime,
  type AsyncResult,
  type FrameRate,
  type Rect,
  type SubjectTrack,
} from '@taalcut/core';
import { probeMedia } from '@taalcut/media';
import {
  layoutBoxOnCanvas,
  layoutCropAt,
  CASTING_CONFIG,
  headMarginOf,
  headsOf,
  showsFace,
  SOLVER_CONFIG,
} from '@taalcut/timeline';
import type { FrameSpan, PlannedVisual } from '../../plan/types';
import { outputFramesAt, visualCurve } from '../../plan/speed-curve';
import { coverWindow, cropAt } from '../../reframe/crop-window';
import type { SourceRect, VisualFraming } from '../../reframe/framing-types';
import { exportJobOf } from '../../ports-phase3';
import type { ExportInputs } from '../export-inputs';
import type { StageContext } from './context';
import type { FramingContext, FramingInputs, PlannedFraming } from './framing';

type Size = { readonly width: number; readonly height: number };

/** A head sample on the canvas: the output frame it was seen at, and the next sample's frame. */
export interface HeadSample {
  readonly frame: number;
  readonly next: number;
  readonly heads: readonly Rect[];
  /** AGT2-MATCH: a face shows on it, as casting's in-point reads one (timeline's `showsFace`). */
  readonly face?: boolean;
}

/** AGT2-MATCH: one clip's samples, for QA's slot match (its face and its framing over the clip's cut). */
export interface ClipHeads {
  readonly id: string;
  readonly cut: FrameSpan;
  readonly visible: FrameSpan;
  readonly samples: readonly HeadSample[];
}

export interface CanvasHeads {
  /** Heads on the canvas around an output frame: the samples just before and after it, of every clip seen then. */
  at(frame: number): Rect[];
  /** Each head, grown by the solver's margin and swept to the next sample, over the frames between them. */
  readonly keepOut: readonly { readonly span: FrameSpan; readonly box: Rect }[];
  /** Video clips seen, and how many of them had a track. */
  readonly clips: number;
  readonly tracked: number;
  /** AGT2-MATCH: each tracked clip's samples (absent from a caller that keeps none). */
  readonly byClip?: readonly ClipHeads[];
}

/** The empty answer: nobody known. */
export const NO_HEADS: CanvasHeads = { at: () => [], keepOut: [], clips: 0, tracked: 0, byClip: [] };

/** A box of the source (fractions) on the canvas, through what the visual shows: a crop window, or bars. */
function mapper(framing: VisualFraming | null, visual: PlannedVisual, source: Size, canvas: Size) {
  const sourceAspect = source.width / source.height;
  const canvasAspect = canvas.width / canvas.height;
  if (framing?.kind === 'crop')
    return (box: SourceRect, local: number) => throughWindow(box, cropAt(framing.keys, local), canvas);
  if (framing?.kind === 'blurPad' || (!framing && visual.fit === 'contain')) {
    const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
    const width = source.width * scale;
    const height = source.height * scale;
    const x = (canvas.width - width) / 2;
    const y = (canvas.height - height) / 2;
    return (box: SourceRect) => ({
      x: x + box.x * width,
      y: y + box.y * height,
      width: box.width * width,
      height: box.height * height,
    });
  }
  const window = coverWindow(sourceAspect, canvasAspect);
  const centre: SourceRect = { x: (1 - window.width) / 2, y: (1 - window.height) / 2, ...window };
  return (box: SourceRect) => throughWindow(box, centre, canvas);
}

/** A source box through a crop window onto the canvas (unclipped, so a head half off the edge stays whole). */
const throughWindow = (box: SourceRect, crop: SourceRect, canvas: Size): Rect => ({
  x: ((box.x - crop.x) / crop.width) * canvas.width,
  y: ((box.y - crop.y) / crop.height) * canvas.height,
  width: (box.width / crop.width) * canvas.width,
  height: (box.height / crop.height) * canvas.height,
});

/** One clip's head samples on the output frames and the canvas. Pure. */
export function clipHeadSamples(
  visual: PlannedVisual,
  track: SubjectTrack,
  source: Size,
  canvas: Size,
  framing: VisualFraming | null,
  rate: FrameRate,
): HeadSample[] {
  const fps = rate.num / rate.den;
  const curve = visualCurve(visual, rate);
  const start = RationalTime.toSeconds(visual.sourceIn);
  const measured = track.samples.some((sample) => sample.heads !== undefined);
  const samples = measured ? track.samples.filter((sample) => sample.heads !== undefined) : track.samples;
  const map = mapper(framing, visual, source, canvas);
  const aspect = source.height / source.width;
  const placed = samples
    .map((sample) => ({
      sample,
      frame: visual.visible.start + outputFramesAt(curve, (RationalTime.toSeconds(sample.t) - start) * fps),
    }))
    .filter(({ frame }) => frame >= visual.visible.start - fps && frame < visual.visible.end + fps)
    .sort((a, b) => a.frame - b.frame);
  return placed.map(({ sample, frame }, index) => {
    const local = Math.min(
      visual.visible.end - visual.visible.start,
      Math.max(0, frame - visual.visible.start),
    );
    return {
      frame: Math.round(frame),
      next: Math.round(placed[index + 1]?.frame ?? frame + fps / 4),
      heads: visual.visualLayout
        ? headsOf(sample, aspect).flatMap((box) =>
            visual.visualLayout!.regions.flatMap((region) => {
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
        : headsOf(sample, aspect).map((box) => map(box, local)),
      face: showsFace(sample.faces, CASTING_CONFIG.inPoint.subjects),
    };
  });
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};
const grow = (rect: Rect, by: number): Rect => ({
  x: rect.x - by,
  y: rect.y - by,
  width: rect.width + 2 * by,
  height: rect.height + 2 * by,
});
const centreDistance = (a: Rect, b: Rect) =>
  Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));

/** Every clip's heads over the render: what is on screen at a frame, and the swept keep-outs. Pure. */
export function canvasHeadsOf(
  perClip: readonly (Pick<ClipHeads, 'visible' | 'samples'> & Partial<Pick<ClipHeads, 'id' | 'cut'>>)[],
  clips: number,
  tracked: number,
): CanvasHeads {
  const keepOut: { span: FrameSpan; box: Rect }[] = [];
  for (const { visible, samples } of perClip)
    samples.forEach((sample, index) => {
      const next = samples[index + 1];
      const span = {
        start: Math.max(visible.start, sample.frame - 1),
        end: Math.min(visible.end, Math.max(sample.next, sample.frame) + 1),
      };
      for (const head of sample.heads) {
        const after = next?.heads
          .filter((other) => centreDistance(head, other) <= 1.5 * Math.max(head.width, head.height))
          .sort((a, b) => centreDistance(a, head) - centreDistance(b, head))[0];
        keepOut.push({
          span,
          box: grow(after ? union(head, after) : head, headMarginOf(head, SOLVER_CONFIG)),
        });
      }
    });
  return {
    at(frame) {
      const out: Rect[] = [];
      for (const { visible, samples } of perClip) {
        if (frame < visible.start || frame >= visible.end) continue;
        const before = [...samples].reverse().find((sample) => sample.frame <= frame);
        const after = samples.find((sample) => sample.frame > frame);
        for (const sample of [before, after]) if (sample) out.push(...sample.heads);
      }
      return out;
    },
    keepOut,
    clips,
    tracked,
    byClip: perClip.flatMap((clip) =>
      clip.id && clip.cut
        ? [{ id: clip.id, cut: clip.cut, visible: clip.visible, samples: clip.samples }]
        : [],
    ),
  };
}

/** The export's heads: what reframing tracked is reused, and a clip with no stored track is tracked now. */
export function planExportHeads(
  stage: StageContext,
  inputs: ExportInputs,
  framing: PlannedFraming | null,
): AsyncResult<CanvasHeads> {
  return planHeads(
    {
      ...(stage.deps.subjectTracks ? { subjectTracks: stage.deps.subjectTracks } : {}),
      media: stage.deps.media,
      burnCaptions: stage.record.captions.burnIn,
      signal: stage.signal,
      trackMissing: true,
      conform: true,
      job: exportJobOf(stage.record),
    },
    inputs,
    framing,
  );
}

const HEADS_CONCURRENCY = 3;

/** Heads on the canvas for every enabled video clip of the plan. */
export async function planHeads(
  context: FramingContext,
  inputs: FramingInputs,
  framing: PlannedFraming | null,
): AsyncResult<CanvasHeads> {
  const source = context.subjectTracks;
  const visuals = inputs.plan.visuals.filter((visual) => visual.enabled && visual.kind === 'video');
  if (!source || visuals.length === 0) return ok({ ...NO_HEADS, clips: visuals.length });
  const canvas = { width: inputs.plan.width, height: inputs.plan.height };
  const rate = inputs.plan.rate;
  const sizes = new Map<string, Promise<Size | null>>();
  const sizeFor = (path: string): Promise<Size | null> => {
    let found = sizes.get(path);
    if (!found) {
      found = probeMedia(path, context.media).then((probe) => {
        const video = probe.ok ? probe.value.video : undefined;
        return video ? { width: video.displayWidth, height: video.displayHeight } : null;
      });
      sizes.set(path, found);
    }
    return found;
  };
  const resolved: (ClipHeads | null)[] = new Array(visuals.length).fill(null);
  let tracked = 0;
  let next = 0;
  const worker = async () => {
    while (next < visuals.length) {
      const index = next++;
      const visual = visuals[index]!;
      const path = inputs.sources.get(visual.id)?.path;
      if (!path) continue;
      const size = await sizeFor(path);
      if (!size) continue;
      const seconds = ((visual.visible.end - visual.visible.start) * rate.den * visual.meanSpeed) / rate.num;
      const range = {
        start: visual.sourceIn,
        duration: RationalTime.fromSeconds(seconds, visual.sourceIn.rate),
      };
      let track = await source.get(visual.assetId, range, context.signal);
      if (track.ok && !track.value && context.trackMissing)
        track = await source.track(visual.assetId, range, context.signal, context.job);
      if (!track.ok || !track.value) continue;
      tracked++;
      const framed = framing?.compose.framing?.visuals.get(visual.id) ?? null;
      resolved[index] = {
        id: visual.id,
        cut: visual.cut,
        visible: visual.visible,
        samples: clipHeadSamples(visual, track.value, size, canvas, framed, rate),
      };
    }
  };
  await Promise.all(Array.from({ length: Math.min(HEADS_CONCURRENCY, visuals.length) }, worker));
  const perClip = resolved.filter((clip): clip is ClipHeads => clip !== null);
  return ok(canvasHeadsOf(perClip, visuals.length, tracked));
}
