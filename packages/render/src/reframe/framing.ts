// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * planVisualFraming: one visual's framing for an export (SPEC P3.2). Pure: the subject track, the source's
 * upright size, the canvas, the safe rect and the caption band in; a VisualFraming out.
 *
 * - Stills, same-aspect clips without a punch-in, and `reframe: null` on the timeline's own canvas: `fit`.
 * - `blurPad` asked: the pad. `centre`: a still crop at the centre plus the nudge.
 * - `auto` / `subject`: the track's samples placed on the visual's output frames (through its speed curve),
 *   followed (target-point), constrained, smoothed (crop-path), then the policy decides follow, centre or pad.
 *   Without a track, the centre crop (`noTrack`): the export carries one warning.
 */
import type { ClipReframe, FrameRate, Rect, SubjectTrack } from '@taalcut/core';
import { RationalTime } from '@taalcut/core';
import { outputFramesAt, visualCurve } from '../plan/speed-curve';
import type { PlannedVisual } from '../plan/types';
import { REFRAME_CONFIG, type ReframeConfig } from './config';
import { pathKeys, pathTravel, smoothPath, type PathPoint } from './crop-path';
import { coverWindow, sameAspect, type Size } from './crop-window';
import type { CropKey, FramingReason, SourceRect, VisualFraming } from './framing-types';
import { chooseFraming, median } from './policy';
import { constrainCentre, followSamples, type FollowedSample, type TimedSample } from './target-point';

/** What `reframe: null` means when the output canvas isn't the timeline's (landscape and 4:3 exports). */
export const AUTO_REFRAME: ClipReframe = { mode: 'auto', nudge: { x: 0, y: 0 }, scale: 1 };

export interface FramingInput {
  readonly visual: Pick<
    PlannedVisual,
    'kind' | 'reframe' | 'visible' | 'cut' | 'sourceIn' | 'speed' | 'holdFrame'
  >;
  /** The source's upright display size, pixels. */
  readonly source: Size;
  /** The output canvas, pixels. */
  readonly canvas: Size;
  /** The preset's safe rect, canvas pixels. */
  readonly safe: Rect;
  /** Top of the burnt-in caption band on the canvas, or null. */
  readonly captionBandTop: number | null;
  readonly track: SubjectTrack | null;
  /** The output rate. */
  readonly rate: FrameRate;
  /** The output canvas differs from the timeline's: every clip is reframed. */
  readonly canvasChanged: boolean;
  readonly config?: ReframeConfig;
}

const FIT: VisualFraming = { kind: 'fit' };

/** The track's samples on the visual's output frames, with a second of margin either side for warm-up. */
function timedSamples(input: FramingInput, frames: number): TimedSample[] {
  if (!input.track) return [];
  if (input.visual.holdFrame) {
    const time = RationalTime.toSeconds(input.visual.holdFrame);
    const nearest = [...input.track.samples].sort(
      (a, b) => Math.abs(RationalTime.toSeconds(a.t) - time) - Math.abs(RationalTime.toSeconds(b.t) - time),
    )[0];
    return nearest
      ? [
          { frame: 0, sample: nearest },
          { frame: frames, sample: nearest },
        ]
      : [];
  }
  const fps = input.rate.num / input.rate.den;
  const curve = visualCurve(input.visual, input.rate);
  const start = RationalTime.toSeconds(input.visual.sourceIn);
  return input.track.samples
    .map((sample) => ({
      frame: outputFramesAt(curve, (RationalTime.toSeconds(sample.t) - start) * fps),
      sample,
    }))
    .filter(({ frame }) => frame >= -fps && frame <= frames + fps)
    .sort((a, b) => a.frame - b.frame);
}

function staticCrop(
  centre: { x: number; y: number },
  crop: Size,
  frames: number,
  reason: FramingReason,
  scale: number,
): VisualFraming {
  const rect: SourceRect = {
    x: centre.x - crop.width / 2,
    y: centre.y - crop.height / 2,
    width: crop.width,
    height: crop.height,
  };
  const keys: CropKey[] = [
    { frame: 0, rect },
    { frame: frames, rect },
  ];
  return { kind: 'crop', reason, keys, subject: [null, null], scale, faces: [null, null], raw: [null, null] };
}

/** A per-key value from the followed samples: the latest sample at or before each key (keys are in order). */
function atKeys<T>(
  keys: readonly { readonly frame: number }[],
  followed: readonly FollowedSample[],
  pick: (sample: FollowedSample, index: number) => T | null,
): (T | null)[] {
  let at = 0;
  return keys.map((key) => {
    while (at + 1 < followed.length && (followed[at + 1]?.frame ?? Infinity) <= key.frame + 0.5) at++;
    const sample = followed[at];
    return sample ? pick(sample, at) : null;
  });
}

export function planVisualFraming(input: FramingInput): VisualFraming {
  const config = input.config ?? REFRAME_CONFIG;
  const { visual, source, canvas } = input;
  if (visual.kind !== 'video') return FIT;
  const reframe = visual.reframe ?? (input.canvasChanged ? AUTO_REFRAME : null);
  if (!reframe) return FIT;
  const sourceAspect = source.width / source.height;
  const canvasAspect = canvas.width / canvas.height;
  if (sameAspect(sourceAspect, canvasAspect, config.aspectTolerance) && reframe.scale <= 1 + 1e-9) return FIT;
  if (reframe.mode === 'blurPad') return { kind: 'blurPad', reason: 'forced' };

  const window = coverWindow(sourceAspect, canvasAspect);
  const crop = { width: window.width / reframe.scale, height: window.height / reframe.scale };
  const cropPx = { width: crop.width * source.width, height: crop.height * source.height };
  const frames = visual.visible.end - visual.visible.start;
  const constraint = { source, crop: cropPx, canvas, safe: input.safe, captionBandTop: input.captionBandTop };
  const toPx = (rect: SourceRect | null): SourceRect | null =>
    rect && {
      x: rect.x * source.width,
      y: rect.y * source.height,
      width: rect.width * source.width,
      height: rect.height * source.height,
    };
  const centre = (face: SourceRect | null) => {
    const point = constrainCentre(
      {
        x: (0.5 + reframe.nudge.x * crop.width) * source.width,
        y: (0.5 + reframe.nudge.y * crop.height) * source.height,
      },
      toPx(face),
      constraint,
    );
    return { x: point.x / source.width, y: point.y / source.height };
  };
  if (reframe.mode === 'centre' || !input.track)
    return staticCrop(
      centre(null),
      crop,
      frames,
      reframe.mode === 'centre' ? 'forced' : 'noTrack',
      reframe.scale,
    );

  const fps = input.rate.num / input.rate.den;
  const followed = followSamples(timedSamples(input, frames), { crop, nudge: reframe.nudge, fps, config });
  const fallback = centre(null);
  const targets: PathPoint[] = followed.map((sample) => {
    const point = sample.raw ?? fallback;
    const constrained = constrainCentre(
      { x: point.x * source.width, y: point.y * source.height },
      toPx(sample.face),
      constraint,
    );
    return { frame: sample.frame, x: constrained.x, y: constrained.y };
  });
  const deadzone = config.deadzoneFraction * source.width;
  const smoothing = (size: number) => ({
    filter: config.oneEuro,
    deadzone,
    maxSpeed: config.maxSpeedCropsPerSecond * size,
  });
  const path = smoothPath(targets, fps, { x: smoothing(cropPx.width), y: smoothing(cropPx.height) });
  const inside = path.filter((point) => point.frame >= 0 && point.frame <= frames);
  const subjects = followed.map((sample) => sample.subject).filter((box): box is SourceRect => box !== null);
  const bodies = followed.map((sample) => sample.body).filter((box): box is SourceRect => box !== null);
  const medianBody =
    bodies.length > 0
      ? {
          width: median(bodies.map((box) => box.width)) ?? 1,
          height: median(bodies.map((box) => box.height)) ?? 1,
        }
      : null;
  const choice = chooseFraming(
    reframe.mode,
    {
      hasSubject: subjects.length > 0,
      medianSubjectArea: median(subjects.map((box) => box.width * box.height)),
      medianBody,
      travelPx: pathTravel(inside.length > 0 ? inside : path),
    },
    crop,
    deadzone,
    config,
  );
  if (choice.kind === 'blurPad') return { kind: 'blurPad', reason: choice.reason };
  if (choice.kind === 'centre' || path.length === 0)
    return staticCrop(fallback, crop, frames, choice.reason, reframe.scale);

  const keysPx = pathKeys(path, frames);
  const keys: CropKey[] = keysPx.map((point) => ({
    frame: point.frame,
    rect: {
      x: Math.min(1 - crop.width, Math.max(0, point.x / source.width - crop.width / 2)),
      y: Math.min(1 - crop.height, Math.max(0, point.y / source.height - crop.height / 2)),
      width: crop.width,
      height: crop.height,
    },
  }));
  // The constrained target the smoother was fed (the jitter check compares the path with it); null where the
  // crop eased to the centre.
  const fed = followed.map((sample, index) => {
    const target = targets[index];
    return sample.raw && target ? { x: target.x / source.width, y: target.y / source.height } : null;
  });
  const rawPoints = atKeys(keys, followed, (_sample, index) => fed[index] ?? null);
  return {
    kind: 'crop',
    reason: choice.reason,
    keys,
    subject: atKeys(keys, followed, (sample) => sample.reference),
    scale: reframe.scale,
    faces: atKeys(keys, followed, (sample) => sample.face),
    raw: rawPoints,
  };
}
