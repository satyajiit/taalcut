// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-MOT: the breakdown's camera-motion analyser (templates' `BreakdownVision.cameraMotion`) over vision's
 * estimator: the background's frame pairs inside each span between candidate cuts, for the slots' measured moves.
 * The tracker is TypeScript on the CPU (decode and scale stay on media's route); the fallback is reported once.
 */
import { computeFallbackEvent, cpuFallback, ok, type ComputeFallbackEvent } from '@taalcut/core';
import type { BreakdownVision } from '@taalcut/templates';
import { cameraMotion, MOTION_CONFIG } from '@taalcut/vision';
import type { AnalyserContext } from './template-analysers';

function cameraFallback(): ComputeFallbackEvent {
  const choice = cpuFallback(
    'no_accelerator',
    'the camera-motion tracker (corners, Lucas-Kanade, RANSAC on 384 px frames) has no GPU form yet',
  );
  if (choice.backend !== 'cpu') throw new Error('unreachable');
  return computeFallbackEvent('vision.cameraMotion', ['videotoolbox', 'cpu'], choice.fallback);
}

export function cameraMotionAnalyser(ctx: AnalyserContext): Required<Pick<BreakdownVision, 'cameraMotion'>> {
  let reported = false;
  return {
    async cameraMotion(path, { ranges, subjects, ignore, signal }) {
      const media = await ctx.media();
      if (!media.ok) return media;
      if (!reported) {
        reported = true;
        ctx.onFallback(cameraFallback());
      }
      const measured = await cameraMotion(
        path,
        { media: media.value },
        { ranges, ...(subjects ? { subjects } : {}), ...(ignore ? { ignore } : {}), signal },
      );
      return measured.ok
        ? ok({
            version: MOTION_CONFIG.version,
            width: measured.value.width,
            height: measured.value.height,
            shots: measured.value.shots,
          })
        : measured;
    },
  };
}
