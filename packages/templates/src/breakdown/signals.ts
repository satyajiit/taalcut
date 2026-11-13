// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The signals runBreakdown reads after the cuts: which disputed cuts are a fade's tail (BRK1, one-shot.ts), and the
 * luma and motion the transitions and speed ramps are classified from. Optional analysers: without luma a fade's
 * tail stays a cut, without motion nothing is a whip or a ramp.
 */
import type { CutFinding } from './cut-merge';
import { fadeStart, isFadeTail } from './one-shot';
import type { StepContext } from './steps';

/** How far past a cut its fade-tail check reads luma, in frames: two seconds at 30 fps. */
const TAIL_FRAMES = 60;

/**
 * The disputed cuts left once a fade's tail is gone: a cut the scene score didn't see strongly that lands inside a
 * fade to black. (A ramp that is one shot drifting never reaches here: findCuts drops it.) `fades` are the frames
 * those fades begin at, so a shot's change is measured before its fade (BRK1 moves).
 */
export async function withoutFadeTails(
  ctx: StepContext,
  confirmed: readonly CutFinding[],
  disputed: readonly CutFinding[],
): Promise<{ kept: CutFinding[]; fades: number[] }> {
  const { config, total } = ctx;
  const lumaCurve = ctx.analysers.media.lumaCurve;
  const weak = disputed.filter((finding) => (finding.score ?? 0) < config.scdet.strong);
  if (!lumaCurve || weak.length === 0) return { kept: [...disputed], fades: [] };
  const bounds = [
    ...confirmed.map((finding) => finding.frame),
    ...disputed.filter((finding) => finding.ruleKeeps).map((finding) => finding.frame),
    total,
  ];
  const endOf = (frame: number) => Math.min(...bounds.filter((bound) => bound > frame), frame + TAIL_FRAMES);
  // From well before the cut, so the fade's start is seen too.
  const ranges = weak.map(
    (finding) => [Math.max(0, finding.frame - TAIL_FRAMES), endOf(finding.frame)] as const,
  );
  const luma = await lumaCurve(ctx.path, { rate: ctx.rate, ranges, signal: ctx.signal });
  if (!luma.ok) return { kept: [...disputed], fades: [] };
  const values = luma.value.map((item) => ({ frame: item.frame, value: item.luma }));
  const tails = weak.filter((finding) => isFadeTail(finding.frame, endOf(finding.frame), values, config));
  return {
    kept: disputed.filter((finding) => !tails.includes(finding)),
    fades: tails.flatMap((finding) => fadeStart(finding.frame, values) ?? []),
  };
}

/** Luma around soft cuts and motion through every shot, when vision and media offer them; scdet's score as the frame-difference rate. */
export async function transitionSignals(
  ctx: StepContext,
  disputed: readonly { readonly ramp: { start: number; end: number } | null }[],
  shots: readonly { start: number; end: number }[],
  scores: readonly number[],
) {
  const { media, vision } = ctx.analysers;
  const around = disputed.flatMap((d) =>
    d.ramp ? [[Math.max(0, d.ramp.start - 3), Math.min(ctx.total, d.ramp.end + 4)] as const] : [],
  );
  const [luma, motion] = await Promise.all([
    media.lumaCurve && around.length > 0
      ? media.lumaCurve(ctx.path, { rate: ctx.rate, ranges: around, signal: ctx.signal })
      : Promise.resolve(null),
    vision.motionCurve
      ? vision.motionCurve(ctx.path, {
          rate: ctx.rate,
          ranges: shots.map((shot) => [shot.start, shot.end] as const),
          signal: ctx.signal,
        })
      : Promise.resolve(null),
  ]);
  return {
    luma: luma?.ok ? luma.value.map((item) => ({ frame: item.frame, value: item.luma })) : [],
    motion: motion?.ok ? motion.value.map((item) => ({ frame: item.frame, value: item.motion })) : [],
    diff: scores.map((value, frame) => ({ frame, value })),
  };
}
