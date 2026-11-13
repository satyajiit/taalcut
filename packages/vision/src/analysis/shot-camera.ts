// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-MOT: a library shot's camera move, measured as the breakdown measures a reel's slot (motion/: the same
 * estimator, classifier and version), so casting's motion match compares like with like: about 10 pairs a second
 * at the estimator's size over each shot's middle 6 s at most (`MOTION_CONFIG.libraryWindow`), from the job's
 * source (the proxy when the job reads it). The shot's `motion` becomes the measure's label; a
 * shot with nothing to track (a flat frame, a photo) keeps the analysis's own class and no measure. A failed measure
 * leaves every shot as the analysis made it: the measure is an addition, never a reason to fail the analysis.
 */
import type { CameraMotionMeasure } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { VideoSource } from '../media/frames';
import { classifyShot } from '../motion/classify';
import { cameraMotion } from '../motion/estimate';
import { MOTION_CONFIG } from '../motion/config';
import { cameraMeasureOf } from '../motion/measure';

export async function measureShotCameras(
  source: VideoSource,
  shots: readonly { readonly shotId: string; readonly start: number; readonly end: number }[],
  media: MediaContext,
  signal: AbortSignal | undefined,
): Promise<Map<string, CameraMotionMeasure>> {
  const measured = new Map<string, CameraMotionMeasure>();
  const windows = shots.flatMap((shot) => {
    const window = middle(shot, source);
    return window.end - window.start >= 2 ? [{ shotId: shot.shotId, ...window }] : [];
  });
  if (windows.length === 0) return measured;
  const found = await cameraMotion(
    source.path,
    { media },
    {
      ranges: windows.map(({ start, end }) => ({ start, end })),
      source,
      ...(signal ? { signal } : {}),
    },
  ).catch(() => null);
  if (!found?.ok) return measured;
  const frame = { width: found.value.width, height: found.value.height };
  for (const shot of windows) {
    const pairs = found.value.shots.find((s) => s.start === shot.start && s.end === shot.end)?.pairs ?? [];
    if (pairs.length === 0 || pairs.every((pair) => pair.motion === null)) continue;
    measured.set(shot.shotId, cameraMeasureOf(classifyShot(pairs, frame)));
  }
  return measured;
}

/** The shot's middle `MOTION_CONFIG.libraryWindow` seconds, in grid frames. */
function middle(shot: { readonly start: number; readonly end: number }, source: VideoSource) {
  const most = Math.round((MOTION_CONFIG.libraryWindow * source.rate.num) / source.rate.den);
  const cut = Math.max(0, shot.end - shot.start - most);
  const start = shot.start + Math.floor(cut / 2);
  return { start, end: Math.min(shot.end, start + Math.max(most, 2)) };
}
