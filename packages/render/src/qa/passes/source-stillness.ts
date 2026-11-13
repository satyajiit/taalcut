// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How long a clip's footage holds the picture the render shows of it from a render freeze's first frame on
 * (docs/qa-gate.md, frozenFrames). The clip's conformed segment is decoded over the freeze's own frames only, seen
 * as the render frames it (a reframed clip's crop window moving along its keys, the blurred pad's whole frame
 * contained in the canvas), and run through the render pass's freezedetect at the footage's tolerance, whose first
 * reference is then the freeze's first frame. So the render and its source are compared on the same frames from
 * the same frame on: a subject followed over a clear sky is a still the footage and its framing make, which a
 * re-render can't change, while two independent reference chains (the render's and the whole segment's) could
 * disagree on near-still footage under an encoder's load-dependent noise.
 */
import type { MediaContext } from '@taalcut/media';
import type { FrameSpan } from '../../plan/types';
import { balancedIf, exprDecimal } from '../../plan/filter-expression';
import { cropAt } from '../../reframe/crop-window';
import type { CropKey, SourceRect } from '../../reframe/framing-types';
import type { SourceStillness } from '../checks/video';
import type { ReframedClip } from '../checks/reframe';
import type { VideoPass, VideoPassOptions } from '../measure/video-pass';
import { QA_THRESHOLDS } from '../thresholds.v1';
import { passWithRetry } from './segment-passes';

type Segments = ReadonlyMap<string, { readonly path: string; readonly startFrame: number }>;

/** How the render shows a clip's conformed segment. */
export type SegmentView =
  /** All of it: the segment is the canvas picture (the clip's fit). */
  | { readonly kind: 'whole' }
  /**
   * A window of the canvas aspect moving along `keys`: frames count from the segment's first frame, rects are
   * fractions of the segment, every rect the same size (a reframed crop).
   */
  | { readonly kind: 'window'; readonly keys: readonly CropKey[] }
  /** The whole segment contained in the canvas, its pad counted as still (the blurred pad). */
  | { readonly kind: 'contained'; readonly canvas: { readonly width: number; readonly height: number } };

const WHOLE: SegmentView = { kind: 'whole' };

/** A source rect as fractions of the region `extent` of the source (the segment's extent). */
const within = (rect: SourceRect, extent: SourceRect): SourceRect => ({
  x: (rect.x - extent.x) / extent.width,
  y: (rect.y - extent.y) / extent.height,
  width: rect.width / extent.width,
  height: rect.height / extent.height,
});

/** The view of a clip's segment: from its reframe record when it has one, else all of it. */
export function segmentView(
  clip: ReframedClip | undefined,
  canvas: { readonly width: number; readonly height: number },
): SegmentView {
  if (!clip) return WHOLE;
  const { framing, extent } = clip;
  if (framing.kind === 'blurPad') return { kind: 'contained', canvas };
  if (framing.kind !== 'crop' || framing.keys.length === 0) return WHOLE;
  return {
    kind: 'window',
    keys: framing.keys.map((key) => ({ frame: key.frame, rect: within(key.rect, extent) })),
  };
}

const decimal = (value: number) => exprDecimal(value, 9);

/**
 * An FFmpeg expression in the filter's frame number n: `value` at each point's `at`, linear between, held outside
 * (a balanced `if` tree over the segments before, between and after the points).
 */
function piecewise(points: readonly { readonly at: number; readonly value: number }[]): string {
  if (points.length === 0) return '0';
  // Segment 0 is before the first point, segment i between points i − 1 and i, segment `after` past the last.
  const after = points.length;
  return balancedIf(
    {
      variable: 'n',
      leaf: (index) => {
        const a = points[Math.max(0, index - 1)]!;
        const b = points[Math.min(after - 1, index)]!;
        const span = b.at - a.at;
        if (index === 0 || index === after || span <= 0) return decimal(b.value);
        return `${decimal(a.value)}+(n-(${decimal(a.at)}))*(${decimal((b.value - a.value) / span)})`;
      },
      start: (index) => decimal(points[index - 1]!.at),
    },
    0,
    after,
  );
}

/**
 * The CPU filters that make frame n of a range starting at segment frame `start` (`frames` long) the picture the
 * render shows: for a window, the crop at `cropAt(keys, start + n)`, from the keys that bracket the range. Pure.
 */
export function viewFilters(view: SegmentView, start: number, frames: number): string[] {
  if (view.kind === 'whole') return [];
  if (view.kind === 'contained') {
    const { width, height } = view.canvas;
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    ];
  }
  const { keys } = view;
  const size = keys[0]?.rect ?? cropAt(keys, start);
  const last = start + Math.max(0, frames - 1);
  // The last key at or before the range's start through the first at or after its end.
  let from = 0;
  while (from + 1 < keys.length && keys[from + 1]!.frame <= start) from += 1;
  let to = keys.length - 1;
  while (to - 1 > from && keys[to - 1]!.frame >= last) to -= 1;
  const span = keys.length > 0 ? keys.slice(from, to + 1) : [{ frame: start, rect: size }];
  const axis = (pick: (rect: SourceRect) => number) =>
    piecewise(span.map((key) => ({ at: key.frame - start, value: pick(key.rect) })));
  return [
    `crop=w=iw*${decimal(size.width)}:h=ih*${decimal(size.height)}:x='iw*(${axis((rect) => rect.x)})':y='ih*(${axis((rect) => rect.y)})'`,
  ];
}

/** Frames the pass's first frame is held for: the freeze that starts on it, else that frame alone. */
function heldFrames(pass: VideoPass): number | undefined {
  if (pass.frames === 0) return undefined;
  const first = pass.freezes[0];
  return first && first.start === 0 ? Math.min(first.end, pass.frames) : 1;
}

/**
 * The stillness measure over each clip's segment, each span measured at most once per QA run. The freeze length
 * is half a frame, so the freeze from the first frame ends exactly where the footage, as framed, moves past the
 * footage's tolerance (QA_THRESHOLDS.frozen.footageNoiseDb).
 */
export function sourceStillness(
  media: MediaContext,
  segments: Segments | undefined,
  viewOf: (clipId: string) => SegmentView,
  options: VideoPassOptions,
): SourceStillness {
  const cache = new Map<string, Promise<number | undefined>>();
  const footage: VideoPassOptions = {
    ...options,
    freezeNoiseDb: QA_THRESHOLDS.frozen.footageNoiseDb,
    freezeMinSeconds: (0.5 * options.rate.den) / options.rate.num,
  };
  return (clipId: string, span: FrameSpan) => {
    const segment = segments?.get(clipId);
    const frames = span.end - span.start;
    const start = segment ? span.start - segment.startFrame : -1;
    if (!segment || start < 0 || frames <= 0) return Promise.resolve(undefined);
    // A still image holds whatever part of it the render shows.
    if (segment.path.endsWith('.jpg')) return Promise.resolve(frames);
    const key = `${clipId}:${span.start}:${span.end}`;
    let found = cache.get(key);
    if (!found) {
      const view = viewFilters(viewOf(clipId), start, frames);
      found = passWithRetry(media, segment.path, { ...footage, range: { start, frames }, view }).then(
        (result) => (result.ok ? heldFrames(result.value) : undefined),
      );
      cache.set(key, found);
    }
    return found;
  };
}
