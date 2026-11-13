// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * graphicsSafeZone, graphicsOverlap and graphicsReadability (P3-V13, HFW1) on the DOM probe's composition boxes at
 * each graphic's moments (checks/graphics.ts). A graphic measured before with nothing changed in what it draws is
 * read from the measurements' cache (qa/graphic-measures.ts), and the probe reads its moments only when something
 * else is on screen then (overlap needs what is there). Graphics on screen and a probe that couldn't read them is a
 * capture fault, never a pass; with no probe at all (no Chrome) the checks say so, skipped.
 */
import { FrameRate, type QaCheckId, type QaCheckResult } from '@taalcut/core';
import {
  capShareOf,
  graphicProbeMoments,
  graphicsOverlapCheck,
  graphicsReadabilityCheck,
  graphicsSafeZoneCheck,
  type GraphicMeasure,
} from '../checks/graphics';
import { measureKey, type GraphicMeasureCache } from '../graphic-measures';
import { checkResult, skipped } from '../result';
import { unmeasured } from '../unmeasured';
import type { QaGraphic, QaPlan } from '../../types';
import type { ProbedFrames, QaCheckModule } from './module';

const IDS = ['graphicsSafeZone', 'graphicsOverlap', 'graphicsReadability'] as const;
const rateOf = (plan: Pick<QaPlan, 'rateNum' | 'rateDen'>) => FrameRate.of(plan.rateNum, plan.rateDen);

/** Something besides the graphic is on screen at `frame`: a caption or another graphic. */
function shared(plan: QaPlan, graphic: QaGraphic, frame: number): boolean {
  const on = (span: { start: number; end: number }) => span.start <= frame && frame < span.end;
  return (
    plan.cues.some((cue) => on(cue.span)) ||
    (plan.graphics ?? []).some((other) => other.id !== graphic.id && on(other.span))
  );
}

/** The frames the probe reads for the graphics: every moment of one not measured yet, and the shared ones. */
export function graphicFrames(plan: QaPlan, cache?: GraphicMeasureCache): number[] {
  const rate = rateOf(plan);
  const frames = new Set<number>();
  for (const graphic of plan.graphics ?? []) {
    const cached = cache?.get(measureKey(graphic, plan));
    for (const frame of graphicProbeMoments(graphic, rate))
      if (!cached || shared(plan, graphic, frame)) frames.add(frame);
  }
  return [...frames].sort((a, b) => a - b);
}

function probedAt(probed: ProbedFrames, graphic: QaGraphic, frame: number): GraphicMeasure {
  const box = probed.boxes.find(
    (entry) =>
      entry.kind === 'graphic' && entry.id === (graphic.programItemId ?? graphic.id) && entry.frame === frame,
  );
  return {
    frame,
    box: (graphic.programItemId ? (box?.textBounds ?? box?.box) : box?.box) ?? null,
    ...(graphic.programItemId && box && !box.textBounds ? { fullCanvas: true } : {}),
    ...(box?.minFontPx !== undefined ? { minFontPx: box.minFontPx } : {}),
    capShare: capShareOf(box?.minFontFamily),
  };
}

/** Each graphic's measures: from the probe where it read the moment, else from the cache; the cache kept fresh. */
function measuresOf(
  plan: QaPlan,
  read: ReadonlySet<number>,
  probed: ProbedFrames | null,
  cache: GraphicMeasureCache | undefined,
): Map<string, GraphicMeasure[]> {
  const rate = rateOf(plan);
  const measures = new Map<string, GraphicMeasure[]>();
  for (const graphic of plan.graphics ?? []) {
    const key = measureKey(graphic, plan);
    const cached = cache?.get(key);
    const moments = graphicProbeMoments(graphic, rate);
    const list = moments.flatMap((frame): GraphicMeasure[] => {
      if (probed && read.has(frame)) return [probedAt(probed, graphic, frame)];
      const kept = cached?.find((entry) => entry.offset === frame - graphic.span.start);
      return kept ? [{ ...kept, frame }] : [];
    });
    measures.set(graphic.id, list);
    if (cache && probed && moments.every((frame) => read.has(frame)))
      cache.set(
        key,
        list.map(({ frame, ...rest }) => ({ ...rest, offset: frame - graphic.span.start })),
      );
  }
  return measures;
}

/** No probe at all (no Chrome): nothing could be drawn to measure, said in the finding. */
const notDrawn = (id: QaCheckId): QaCheckResult =>
  checkResult(id, 'skipped', { findings: [{ target: { kind: 'file', id: 'domProbe' } }] }, 0);

export const graphicsQaModule: QaCheckModule = {
  ids: IDS,
  probeFrames: ({ run }) => graphicFrames(run.plan, run.graphicMeasures),
  async run({ run, probed }, wanted) {
    const ids = IDS.filter((id) => wanted.has(id));
    const graphics = run.plan.graphics ?? [];
    if (graphics.length === 0) return ids.map((id) => skipped(id));
    const cache = run.graphicMeasures;
    // Read before any measure goes into the cache: the frames the probe was asked for.
    const read = new Set(graphicFrames(run.plan, cache));
    if (read.size > 0 && !probed)
      return ids.map((id) => (run.probe || run.probeFrame ? unmeasured(id, 'domProbe') : notDrawn(id)));
    const input = {
      graphics,
      measures: measuresOf(run.plan, read, probed, cache),
      boxes: probed?.boxes ?? [],
      safe: run.preset.safe,
      canvas: { width: run.plan.width, height: run.plan.height },
      rate: rateOf(run.plan),
      target: run.target,
    };
    const results: QaCheckResult[] = [];
    if (wanted.has('graphicsSafeZone')) results.push(graphicsSafeZoneCheck(input));
    if (wanted.has('graphicsOverlap')) results.push(graphicsOverlapCheck(input));
    if (wanted.has('graphicsReadability')) results.push(graphicsReadabilityCheck(input));
    return results;
  },
};
