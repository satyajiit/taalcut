// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `graphicCoversFace` (FRM1-OVL; docs/qa-gate.md "Reframing"): whether a graphic or a text item covers a person's
 * head on any probed frame of its time, four a second and its last frame, for every video clip of the render,
 * reframed or not. Heads come from each clip's subject track through what the clip shows on the canvas
 * (engine/stages/heads.ts), the samples either side of the frame. A graphic over a head fails, and the person may
 * export anyway, as with `captionCoversFace`. A clip it has no track for is not seen: the check warns with how
 * many, never passes them silently. Pure.
 *
 * TXT1 (the owner's rule: no code decides where text sits): a text item over a head is a note, never a failure.
 * The check warns, and its findings name each such text with the frames a head is under it: a fact for whoever
 * placed the text to judge (render.draft's `textNotes`). A failure would send the model dodging heads one text at a
 * time, which is how a video's text ends up scattered. While a graphic fails, the findings are the graphics'.
 */
import { overlapArea, type FrameRate, type QaCheckResult, type Rect } from '@taalcut/core';
import type { FrameSpan } from '../../plan/types';
import type { ProbedTextBox } from '../../types';
import { checkResult, skipped, spanFinding, type QaFinding } from '../result';

export const FACE_COVER_THRESHOLDS = {
  version: 1,
  /** Probed frames a second over each item's time. */
  framesPerSecond: 4,
  /** Boxes may touch a head by this much (rounding of the probe's boxes). */
  tolerancePx: 1,
} as const;

export interface FaceCoverItem {
  readonly id: string;
  readonly span: FrameSpan;
}

export interface FaceCoverInput {
  /** Every graphic and text item of the render, on its frames. */
  readonly items: readonly FaceCoverItem[];
  /** The probe's boxes at the frames `faceProbeFrames` chose. */
  readonly boxes: readonly ProbedTextBox[];
  /** Heads on the canvas around an output frame. */
  readonly heads: (frame: number) => readonly Rect[];
  /** Video clips in the render, and how many had a subject track. */
  readonly clips: number;
  readonly tracked: number;
}

/** The frames the probe reads for the check: four a second over each item's time, and its last frame. */
export function faceProbeFrames(items: readonly FaceCoverItem[], rate: FrameRate): number[] {
  const step = Math.max(1, Math.round(rate.num / rate.den / FACE_COVER_THRESHOLDS.framesPerSecond));
  const frames = new Set<number>();
  for (const item of items) {
    for (let frame = item.span.start; frame < item.span.end; frame += step) frames.add(frame);
    if (item.span.end > item.span.start) frames.add(item.span.end - 1);
  }
  return [...frames].sort((a, b) => a - b);
}

export function graphicCoversFaceCheck(input: FaceCoverInput, durationMs = 0): QaCheckResult {
  if (input.items.length === 0) return skipped('graphicCoversFace', durationMs);
  const ids = new Set(input.items.map((item) => item.id));
  const covering = { graphic: new Map<string, number[]>(), text: new Map<string, number[]>() };
  for (const probed of input.boxes) {
    if ((probed.kind !== 'graphic' && probed.kind !== 'text') || !ids.has(probed.id)) continue;
    const hit = input
      .heads(probed.frame)
      .some((head) => overlapArea(probed.box, head, FACE_COVER_THRESHOLDS.tolerancePx) > 0);
    if (!hit) continue;
    const frames = covering[probed.kind];
    frames.set(probed.id, [...(frames.get(probed.id) ?? []), probed.frame]);
  }
  // A graphic over a head is the failure; with none, the texts over one are the warning's notes.
  const failed = covering.graphic.size > 0;
  const reported = failed ? covering.graphic : covering.text;
  const findings: QaFinding[] = [...reported].map(([id, frames]) =>
    spanFinding(
      { start: Math.min(...frames), end: Math.max(...frames) + 1 },
      { kind: 'text', id },
      { value: frames.length, unit: 'frames' },
    ),
  );
  const unseen = input.clips - input.tracked;
  if (findings.length === 0 && unseen > 0)
    findings.push({
      target: { kind: 'file', id: 'subjectTrack' },
      measured: { value: unseen, unit: 'count' },
    });
  const frames = [...reported.values()].reduce((sum, list) => sum + list.length, 0);
  return checkResult(
    'graphicCoversFace',
    failed ? 'fail' : covering.text.size > 0 || unseen > 0 ? 'warn' : 'pass',
    {
      measured: { value: frames, unit: 'frames' },
      threshold: { max: 0, unit: 'frames' },
      findings: findings.slice(0, 50),
    },
    durationMs,
  );
}

/**
 * What the check saw, for a gate's independent face check (FRM1-OVL): every graphic and text item with its frames,
 * and at each probed frame the probe's box for each of them and render's heads around it. Canvas pixels.
 */
export interface FaceBoxesDump {
  readonly items: readonly FaceCoverItem[];
  readonly frames: readonly {
    readonly frame: number;
    readonly boxes: readonly { readonly id: string; readonly kind: 'graphic' | 'text'; readonly box: Rect }[];
    readonly heads: readonly Rect[];
  }[];
  readonly clips: number;
  readonly tracked: number;
}

export function faceBoxesDump(input: FaceCoverInput): FaceBoxesDump {
  const ids = new Set(input.items.map((item) => item.id));
  const byFrame = new Map<number, { id: string; kind: 'graphic' | 'text'; box: Rect }[]>();
  for (const probed of input.boxes) {
    if ((probed.kind !== 'graphic' && probed.kind !== 'text') || !ids.has(probed.id)) continue;
    byFrame.set(probed.frame, [
      ...(byFrame.get(probed.frame) ?? []),
      { id: probed.id, kind: probed.kind, box: probed.box },
    ]);
  }
  return {
    items: input.items,
    frames: [...byFrame]
      .sort(([a], [b]) => a - b)
      .map(([frame, boxes]) => ({ frame, boxes, heads: input.heads(frame) })),
    clips: input.clips,
    tracked: input.tracked,
  };
}
