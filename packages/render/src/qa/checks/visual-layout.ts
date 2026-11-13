// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  RationalTime,
  type FrameRate,
  type QaCheckResult,
  type Rect,
  type SubjectTrack,
} from '@taalcut/core';
import { headsOf, layoutBoxOnCanvas, layoutCropAt, layoutTransform } from '@taalcut/timeline';
import type { PlannedVisual } from '../../plan/types';
import { outputFramesAt, visualCurve } from '../../plan/speed-curve';
import { layoutSourceTime, type LayoutSize } from '../../reframe/visual-layout';
import { rectsOverlap } from '../../reframe/caption-dodge';
import { measureJitter } from '../../reframe/jitter';
import { REFRAME_CONFIG } from '../../reframe/config';
import type { ProbedTextBox, ProbedVisual } from '../../types';
import { unmeasured } from '../unmeasured';
import { checkResult, skipped, spanFinding, type QaFinding } from '../result';

export interface LayoutClip {
  readonly visual: PlannedVisual;
  readonly source: LayoutSize;
  readonly track: SubjectTrack | null;
}

export interface LayoutQaInput {
  readonly clips: readonly LayoutClip[];
  readonly canvas: LayoutSize;
  readonly rate: FrameRate;
  readonly probed?: readonly ProbedVisual[];
  readonly transitions?: readonly { readonly start: number; readonly end: number }[];
}

/** Native panels share their transform with rendering, graphics placement and head checks. */
export function layoutHeadsAt(
  clips: readonly LayoutClip[],
  frame: number,
  canvas: LayoutSize,
  rate: FrameRate,
): Rect[] {
  return clips.flatMap(({ visual, source, track }) => {
    if (!track || frame < visual.visible.start || frame >= visual.visible.end) return [];
    const time = layoutSourceTime(visual, frame, rate);
    const sample = [...track.samples].sort(
      (a, b) => Math.abs(RationalTime.toSeconds(a.t) - time) - Math.abs(RationalTime.toSeconds(b.t) - time),
    )[0];
    if (!sample || Math.abs(RationalTime.toSeconds(sample.t) - time) > 1) return [];
    return headsOf(sample, source.height / source.width).flatMap((box) =>
      visual.visualLayout!.regions.flatMap((region) => {
        const mapped = layoutBoxOnCanvas(box, region, layoutCropAt(region, time), source, canvas);
        return mapped ? [mapped] : [];
      }),
    );
  });
}

const gap = (a: Rect, b: Rect) =>
  Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height),
  );

function sameInset(a: string, b: string): boolean {
  const values = (text: string) => {
    const parts = [...text.matchAll(/(-?[\d.]+)%/g)].map((match) => Number(match[1]));
    const [top, right = top, bottom = top, left = right] = parts;
    return parts.length >= 1 && parts.length <= 4 ? [top!, right!, bottom!, left!] : [];
  };
  const actual = values(a);
  return actual.length === 4 && values(b).every((value, index) => Math.abs(value - actual[index]!) < 0.001);
}

export function layoutSubjectCheck(input: LayoutQaInput): QaCheckResult {
  if (input.clips.length > 0 && input.probed === undefined) return unmeasured('subjectInFrame', 'domProbe');
  const findings: QaFinding[] = [];
  let counted = 0;
  let worst = 1;
  let probes = 0;
  let probeFailures = 0;
  for (const { visual, source, track } of input.clips) {
    const regions = visual.visualLayout!.regions;
    let clipCount = 0;
    let clipInside = 0;
    const seenRegions = new Set<number>();
    for (const sample of track?.samples ?? []) {
      const time = RationalTime.toSeconds(sample.t);
      const local = outputFramesAt(
        visualCurve(visual, input.rate),
        ((time - RationalTime.toSeconds(visual.sourceIn)) * input.rate.num) / input.rate.den,
      );
      const frame = Math.round(visual.visible.start + local);
      if (frame < visual.visible.start || frame >= visual.visible.end) continue;
      const boxes = headsOf(sample, source.height / source.width);
      if (boxes.length === 0) continue;
      counted++;
      clipCount++;
      const covered = boxes.every((box) =>
        regions.some((region) => {
          const crop = layoutCropAt(region, time);
          const mapped = layoutBoxOnCanvas(box, region, crop, source, input.canvas);
          const { scale } = layoutTransform(region, crop, source, input.canvas);
          const area = box.width * source.width * box.height * source.height * scale * scale;
          return mapped && (mapped.width * mapped.height) / area >= REFRAME_CONFIG.boxInsideShare;
        }),
      );
      if (covered) clipInside++;
      else findings.push(spanFinding({ start: frame, end: frame + 1 }, { kind: 'clip', id: visual.id }));
    }
    if (clipCount) worst = Math.min(worst, clipInside / clipCount);
    for (const probe of input.probed ?? []) {
      if (input.transitions?.some((span) => probe.frame >= span.start && probe.frame < span.end)) continue;
      if (probe.frame < visual.visible.start || probe.frame >= visual.visible.end || probe.opacity <= 0)
        continue;
      const index = regions.findIndex((_, i) => probe.id === `${visual.id}:region:${i}`);
      if (index < 0) continue;
      probes++;
      seenRegions.add(index);
      const region = regions[index]!;
      const crop = layoutCropAt(region, layoutSourceTime(visual, probe.frame, input.rate));
      const placed = layoutTransform(region, crop, source, input.canvas);
      const expected = {
        x: placed.viewport.x + placed.x,
        y: placed.viewport.y + placed.y,
        width: source.width * placed.scale,
        height: source.height * placed.scale,
      };
      if (
        !probe.box ||
        !probe.viewport ||
        gap(probe.box, expected) > 1 ||
        gap(probe.viewport, placed.viewport) > 1 ||
        (probe.clipPath !== undefined && !sameInset(probe.clipPath, placed.clipPath))
      ) {
        probeFailures++;
        findings.push(
          spanFinding({ start: probe.frame, end: probe.frame + 1 }, { kind: 'clip', id: visual.id }),
        );
      }
    }
    if (seenRegions.size !== regions.length) {
      probeFailures++;
      findings.push(spanFinding(visual.visible, { kind: 'clip', id: visual.id }));
    }
  }
  if (input.clips.length > 0 && probes === 0) return unmeasured('subjectInFrame', 'nativeLayoutProbe');
  if (counted === 0 && probes === 0) return skipped('subjectInFrame');
  const share = worst;
  return checkResult(
    'subjectInFrame',
    share < REFRAME_CONFIG.framesInShare || probeFailures > 0 ? 'fail' : 'pass',
    {
      measured: { value: Math.round(share * 1000) / 10, unit: 'percent' },
      threshold: { min: REFRAME_CONFIG.framesInShare * 100, unit: 'percent' },
      findings,
    },
    0,
  );
}

export function layoutCaptionCheck(input: LayoutQaInput, captions: readonly ProbedTextBox[]): QaCheckResult {
  const cues = captions.filter((cue) => cue.kind === 'caption');
  if (cues.length === 0 || input.clips.length === 0) return skipped('captionCoversFace');
  const findings = cues.flatMap((cue) =>
    layoutHeadsAt(input.clips, cue.frame, input.canvas, input.rate).some((head) =>
      rectsOverlap(head, cue.box),
    )
      ? [spanFinding({ start: cue.frame, end: cue.frame + 1 }, { kind: 'caption', id: cue.id })]
      : [],
  );
  return checkResult(
    'captionCoversFace',
    findings.length ? 'fail' : 'pass',
    {
      measured: { value: findings.length, unit: 'count' },
      threshold: { max: 0, unit: 'count' },
      findings,
    },
    0,
  );
}

export function layoutJitterCheck(input: LayoutQaInput): QaCheckResult {
  if (input.clips.length === 0) return skipped('cropJitter');
  const findings: QaFinding[] = [];
  for (const { visual, source } of input.clips)
    for (const region of visual.visualLayout!.regions) {
      const frames = visual.visible.end - visual.visible.start;
      for (const axis of ['x', 'y'] as const) {
        const size = axis === 'x' ? 'width' : 'height';
        const first = layoutCropAt(region, layoutSourceTime(visual, visual.visible.start, input.rate));
        const px = (region.viewport[size] * input.canvas[size]) / first[size];
        const path = Array.from({ length: frames + 1 }, (_, frame) => {
          const crop = layoutCropAt(
            region,
            layoutSourceTime(visual, visual.visible.start + frame, input.rate),
          );
          return (crop[axis] + crop[size] / 2) * px;
        });
        const report = measureJitter({
          path,
          raw: [],
          fps: input.rate.num / input.rate.den,
          deadzone: REFRAME_CONFIG.deadzoneFraction * px * (axis === 'x' ? 1 : source.width / source.height),
        });
        for (const wobble of report.wobbles)
          findings.push(
            spanFinding(
              { start: visual.visible.start + wobble.frame, end: visual.visible.start + wobble.frame + 1 },
              { kind: 'clip', id: visual.id },
            ),
          );
      }
    }
  return checkResult(
    'cropJitter',
    findings.length ? 'fail' : 'pass',
    {
      measured: { value: findings.length, unit: 'count' },
      threshold: { max: 0, unit: 'count' },
      findings,
    },
    0,
  );
}

/** Existing QA ids cover ordinary crops and native layouts in a mixed timeline. */
export function mergeLayoutCheck(a: QaCheckResult, b: QaCheckResult): QaCheckResult {
  if (a.status === 'skipped') return b;
  if (b.status === 'skipped') return a;
  const status =
    a.status === 'fail' || b.status === 'fail'
      ? 'fail'
      : a.status === 'warn' || b.status === 'warn'
        ? 'warn'
        : 'pass';
  return {
    ...a,
    status,
    ...(a.measured && b.measured && a.measured.unit === b.measured.unit
      ? {
          measured: {
            ...a.measured,
            value:
              a.id === 'subjectInFrame'
                ? Math.min(a.measured.value, b.measured.value)
                : a.measured.value + b.measured.value,
          },
        }
      : {}),
    durationMs: a.durationMs + b.durationMs,
    findings: [...a.findings, ...b.findings].slice(0, 50),
    fixes: [...a.fixes, ...b.fixes].slice(0, 5),
  };
}
