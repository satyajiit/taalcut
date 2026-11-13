// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: what the make's frame checks hold a composition to on a made timeline: the people's heads on the canvas
 * round a frame (FRM1's subject tracks, through what each clip shows), and the graphics' safe rect, as shares of the
 * canvas. A composition lays itself out, so nothing here moves or sizes it: a check that fails sends the frame back
 * to the Designer (render's `checkFills`).
 */
import type { Box, SubjectSource, Timeline } from '@taalcut/core';
import { safeFor } from './place-items';
import { spansFor, type PlacementDeps } from './run-placement';
import { clipSourceRange, framesDuring, placedClips, sceneFramesOf } from './subjects';
import type { Rect } from './geometry';

export interface CheckScene {
  /** Heads round a timeline frame (one detect step either side), as shares of the canvas. */
  heads(frame: number): Box[];
  /** Where a graphic must stay, as shares of the canvas. */
  readonly safe: Box;
  readonly warnings: readonly string[];
}

const shares = (rect: Rect, canvas: { width: number; height: number }): Box => ({
  x: rect.x / canvas.width,
  y: rect.y / canvas.height,
  width: rect.width / canvas.width,
  height: rect.height / canvas.height,
});

export async function checkSceneOf(
  timeline: Timeline,
  subjects: SubjectSource | undefined,
  deps: Omit<PlacementDeps, 'subjects'> = {},
): Promise<CheckScene> {
  const canvas = { width: timeline.canvas.width, height: timeline.canvas.height };
  const fps = timeline.canvas.rate.num / timeline.canvas.rate.den;
  const safe = shares(safeFor('graphic', canvas), canvas);
  const warnings: string[] = [];
  if (!subjects) return { heads: () => [], safe, warnings: ['frame checks: nobody known in the clips'] };
  const clips = placedClips(timeline).filter((placed) => placed.clip.media.kind === 'video');
  const spans = await spansFor(
    subjects,
    clips.map((placed) => ({
      key: placed.clip.id,
      range: { assetId: placed.clip.media.assetId, ...clipSourceRange(placed.clip, timeline.canvas.rate) },
    })),
    warnings,
    { ...deps, subjects },
  );
  const frames = sceneFramesOf(
    clips.map((placed) => ({ placed, span: spans.get(placed.clip.id) })),
    canvas,
    fps,
  );
  return {
    heads: (frame) =>
      framesDuring(frames, { start: frame, end: frame + 1 }, fps).flatMap((scene) =>
        scene.heads.map((head) => shares(head, canvas)),
      ),
    safe,
    warnings,
  };
}
