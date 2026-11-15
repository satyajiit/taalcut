// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * findCuts' third look (MATCH1): the reel's frames as small gray pictures, the dissolves and fades measured from
 * them (gradual.ts), and each put into the findings with method B's word on its two sides. A composition without the
 * port looks for cuts with the two methods only, as before MATCH1. When the port is there and reading the frames
 * fails, the findings stand as the two methods left them and the breakdown says so in its warnings.
 */
import { FrameRate, ok, type AsyncResult } from '@taalcut/core';
import type { BreakdownConfig } from './config';
import { spanDistance, type CutFinding, type VectorAt } from './cut-merge';
import { findGradual, withGradual } from './gradual';
import type { BreakdownMedia } from './ports';

/** What this look reads of a step's context (steps.ts's `StepContext`, which fits it). */
export interface GradualContext {
  readonly path: string;
  readonly rate: FrameRate;
  readonly total: number;
  readonly analysers: { readonly media: Pick<BreakdownMedia, 'grayFrames'> };
  readonly config: BreakdownConfig;
  readonly signal: AbortSignal;
}

export interface GradualCuts {
  readonly findings: CutFinding[];
  /** Why no transition was looked for, when the frames could not be read. */
  readonly warning?: string;
}

export async function gradualCuts(
  ctx: GradualContext,
  findings: readonly CutFinding[],
  embed: (frames: readonly number[]) => AsyncResult<undefined>,
  vectorAt: VectorAt,
): AsyncResult<GradualCuts> {
  const { media } = ctx.analysers;
  const { config, total } = ctx;
  if (!media.grayFrames) return ok({ findings: [...findings] });
  const gray = await media.grayFrames(ctx.path, {
    rate: ctx.rate,
    longSide: config.gradual.longSide,
    signal: ctx.signal,
  });
  if (!gray.ok) return ok({ findings: [...findings], warning: `gradual_failed: ${gray.error.code}` });
  const transitions = findGradual(gray.value.frames, FrameRate.toNumber(ctx.rate), config.gradual).filter(
    (transition) => transition.end < total - 1,
  );
  if (transitions.length === 0) return ok({ findings: [...findings] });
  const { context } = config.embed;
  const sides = transitions.flatMap((transition) =>
    Array.from({ length: context }, (_, i) => [transition.start - 1 - i, transition.end + 1 + i]).flat(),
  );
  const embedded = await embed([...new Set(sides)].sort((a, b) => a - b));
  if (!embedded.ok) return embedded;
  return ok({
    findings: withGradual(
      findings,
      transitions,
      (transition) => spanDistance(vectorAt, transition, total, context),
      config,
    ),
  });
}

/** Spans of frames that are not one shot's own picture. */
export type Blends = readonly { readonly start: number; readonly end: number }[];

/**
 * A shot's first or last frame, moved out of a transition that holds it (to the frame after it, or before) while
 * that stays in the shot: what the Analyst is shown of a shot is the shot's own picture.
 */
export function clearOf(
  frame: number,
  shot: { readonly start: number; readonly end: number },
  blends: Blends,
  step: 1 | -1,
): number {
  const blend = blends.find((item) => frame >= item.start && frame <= item.end);
  if (!blend) return frame;
  const moved = step > 0 ? blend.end + 1 : blend.start - 1;
  return moved >= shot.start && moved < shot.end ? moved : frame;
}

/** The two frames a disputed cut is judged by: the last before it and the first after, outside its transition. */
export function disputeSides(
  frame: number,
  total: number,
  blends: Blends,
): { before: number; after: number } {
  const blend = blends.find((item) => frame >= item.start && frame <= item.end + 1);
  const before = blend ? blend.start - 1 : frame - 1;
  const after = blend ? blend.end + 1 : frame;
  return { before: Math.max(0, before), after: Math.min(total - 1, after) };
}
