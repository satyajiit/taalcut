// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The reframe checks (SPEC P3.10; docs/qa-gate.md "Reframing"):
 *
 * - `subjectInFrame`: per reframed clip, ≥ 95 % of the frames with a subject keep ≥ 95 % of its reference box
 *   (face, else human) on the canvas. The DOM probe's crop (computed object-position, scale, transform-origin)
 *   must match the plan within 1 px where it was read; between probes the plan is used. Fix: blurred pad.
 * - `cropJitter`: no hold violations and no wobbles on the path at the output rate. Fix: the centre crop.
 * - `captionCoversFace`: a cue's probed box never overlaps a face at its middle frame. Fix: a caption anchor
 *   that clears the face.
 *
 * Pure: the caller hands in the framings, the probe's readings and the caption boxes.
 */
import {
  CAPTION_COMMANDS,
  TIMELINE_COMMANDS,
  type ClipReframe,
  type FrameRate,
  type QaCheckResult,
  type Rect,
} from '@taalcut/core';
import type { FrameSpan } from '../../plan/types';
import { clearTop, rectsOverlap } from '../../reframe/caption-dodge';
import { REFRAME_CONFIG, type ReframeConfig } from '../../reframe/config';
import { boxAt, cropAt } from '../../reframe/crop-window';
import type { SourceRect, VisualFraming } from '../../reframe/framing-types';
import { measureJitter } from '../../reframe/jitter';
import { probedCrop } from '../../reframe/keyframes';
import { onCanvas, subjectCoverage } from '../../reframe/subject-coverage';
import type { ProbedTextBox, ProbedVisual } from '../../types';
import { checkResult, commandFix, skipped, spanFinding, type QaFinding, type QaTarget } from '../result';

export interface ReframedClip {
  readonly clipId: string;
  /** The clip's visible window on the render. */
  readonly visible: FrameSpan;
  readonly framing: VisualFraming;
  /** The clip's reframe setting (the fixes keep its nudge and punch-in). */
  readonly reframe: ClipReframe | null;
  /** Upright source size, pixels. */
  readonly source: { readonly width: number; readonly height: number };
  /** The media region the element shows (the segment's extent). */
  readonly extent: SourceRect;
}

export interface ReframeQaInput {
  readonly clips: readonly ReframedClip[];
  readonly canvas: { readonly width: number; readonly height: number };
  readonly rate: FrameRate;
  readonly target: QaTarget;
  /** The DOM probe's readings of `[data-tc-visual]` elements (2 fps). */
  readonly probed?: readonly ProbedVisual[];
  /** Frames where transitions move or zoom visuals: their computed style isn't the crop's. */
  readonly transitions?: readonly FrameSpan[];
  readonly config?: ReframeConfig;
}

type CropClip = ReframedClip & { readonly framing: Extract<VisualFraming, { kind: 'crop' }> };
const crops = (clips: readonly ReframedClip[]): CropClip[] =>
  clips.filter((clip): clip is CropClip => clip.framing.kind === 'crop');

const inSpan = (frame: number, span: FrameSpan) => frame >= span.start && frame < span.end;

const setReframe = (target: QaTarget, clip: ReframedClip, mode: 'blurPad' | 'centre', labelKey: string) =>
  commandFix(labelKey, TIMELINE_COMMANDS.setReframe, {
    ...target,
    clipId: clip.clipId,
    reframe: {
      mode,
      nudge: mode === 'centre' ? (clip.reframe?.nudge ?? { x: 0, y: 0 }) : { x: 0, y: 0 },
      scale: mode === 'centre' ? (clip.reframe?.scale ?? 1) : 1,
    },
  });

/** The largest gap, in canvas pixels, between the probed and the planned crop's edges. */
export function probeGapPx(planned: SourceRect, probed: SourceRect, canvas: ReframeQaInput['canvas']): number {
  const sx = canvas.width / planned.width;
  const sy = canvas.height / planned.height;
  return Math.max(
    Math.abs(planned.x - probed.x) * sx,
    Math.abs(planned.x + planned.width - (probed.x + probed.width)) * sx,
    Math.abs(planned.y - probed.y) * sy,
    Math.abs(planned.y + planned.height - (probed.y + probed.height)) * sy,
  );
}

export function subjectInFrameCheck(input: ReframeQaInput, durationMs = 0): QaCheckResult {
  const config = input.config ?? REFRAME_CONFIG;
  const findings: QaFinding[] = [];
  const failing: CropClip[] = [];
  let worst: number | null = null;
  for (const clip of crops(input.clips)) {
    const frames = clip.visible.end - clip.visible.start;
    const sourceAspect = clip.source.width / clip.source.height;
    const probed = new Map<number, SourceRect>();
    for (const reading of input.probed ?? []) {
      if (reading.id !== clip.clipId || !inSpan(reading.frame, clip.visible) || reading.opacity <= 0)
        continue;
      if ((input.transitions ?? []).some((span) => inSpan(reading.frame, span))) continue;
      const local = reading.frame - clip.visible.start;
      const drawn = probedCrop(reading, { canvas: input.canvas, extent: clip.extent, sourceAspect });
      const planned = cropAt(clip.framing.keys, local);
      const gap = drawn ? probeGapPx(planned, drawn, input.canvas) : Number.POSITIVE_INFINITY;
      if (gap > config.probeTolerancePx) {
        findings.push(
          spanFinding(
            { start: reading.frame, end: reading.frame + 1 },
            { kind: 'clip', id: clip.clipId },
            {
              value: Number.isFinite(gap) ? Math.round(gap * 10) / 10 : 9999,
              unit: 'px',
            },
          ),
        );
        if (!failing.includes(clip)) failing.push(clip);
      }
      if (drawn) probed.set(local, drawn);
    }
    const coverage = subjectCoverage(
      frames,
      (frame) => probed.get(frame) ?? cropAt(clip.framing.keys, frame),
      (frame) => boxAt(clip.framing.keys, clip.framing.subject, frame),
      config,
    );
    if (coverage.counted === 0) continue;
    worst = Math.min(worst ?? 1, coverage.share);
    if (coverage.share < config.framesInShare) {
      if (!failing.includes(clip)) failing.push(clip);
      const first = coverage.misses[0] ?? 0;
      const last = coverage.misses[coverage.misses.length - 1] ?? first;
      findings.push(
        spanFinding(
          { start: clip.visible.start + first, end: clip.visible.start + last + 1 },
          { kind: 'clip', id: clip.clipId },
          { value: Math.round(coverage.share * 1000) / 10, unit: 'percent' },
        ),
      );
    }
  }
  if (worst === null && findings.length === 0) return skipped('subjectInFrame', durationMs);
  return checkResult(
    'subjectInFrame',
    failing.length > 0 ? 'fail' : 'pass',
    {
      measured: { value: Math.round((worst ?? 1) * 1000) / 10, unit: 'percent' },
      threshold: { min: config.framesInShare * 100, unit: 'percent' },
      findings,
      fixes: failing.map((clip) => setReframe(input.target, clip, 'blurPad', 'qa.fixes.reframeBlurPad')),
    },
    durationMs,
  );
}

export function cropJitterCheck(input: ReframeQaInput, durationMs = 0): QaCheckResult {
  const config = input.config ?? REFRAME_CONFIG;
  const fps = input.rate.num / input.rate.den;
  const findings: QaFinding[] = [];
  const failing: CropClip[] = [];
  let measured = 0;
  const moving = crops(input.clips).filter((clip) => clip.framing.keys.length > 1);
  for (const clip of moving) {
    const { keys, raw } = clip.framing;
    const frames = clip.visible.end - clip.visible.start;
    const window = keys[0]?.rect ?? { width: 1, height: 1 };
    // Canvas pixels per source fraction on each axis; the deadzone is a share of the source width.
    const px = { x: input.canvas.width / window.width, y: input.canvas.height / window.height };
    const deadzone = {
      x: config.deadzoneFraction * px.x,
      y: ((config.deadzoneFraction * clip.source.width) / clip.source.height) * px.y,
    };
    for (const axis of ['x', 'y'] as const) {
      const size = axis === 'x' ? 'width' : 'height';
      const path = Array.from({ length: frames + 1 }, (_, frame) => {
        const crop = cropAt(keys, frame);
        return (crop[axis] + crop[size] / 2) * px[axis];
      });
      const report = measureJitter({
        path,
        raw: keys.map((key, index) => ({
          frame: key.frame,
          value: raw[index] ? (raw[index]?.[axis] ?? 0) * px[axis] : null,
        })),
        deadzone: deadzone[axis],
        fps,
        config,
      });
      const problems = [
        ...report.holdViolations.map((entry) => entry.frame),
        ...report.wobbles.map((entry) => entry.frame),
      ];
      measured += problems.length;
      for (const frame of problems.slice(0, 10))
        findings.push(
          spanFinding(
            { start: clip.visible.start + frame, end: clip.visible.start + frame + 1 },
            { kind: 'clip', id: clip.clipId },
          ),
        );
      if (problems.length > 0 && !failing.includes(clip)) failing.push(clip);
    }
  }
  if (moving.length === 0) return skipped('cropJitter', durationMs);
  return checkResult(
    'cropJitter',
    measured > 0 ? 'fail' : 'pass',
    {
      measured: { value: measured, unit: 'count' },
      threshold: { max: 0, unit: 'count' },
      findings,
      fixes: failing.map((clip) => setReframe(input.target, clip, 'centre', 'qa.fixes.reframeCentre')),
    },
    durationMs,
  );
}

/** Face boxes on the canvas at a render frame: every crop visible then, through its crop. */
export function facesOnCanvasAt(
  clips: readonly ReframedClip[],
  frame: number,
  canvas: ReframeQaInput['canvas'],
): Rect[] {
  const faces: Rect[] = [];
  for (const clip of crops(clips)) {
    if (!inSpan(frame, clip.visible)) continue;
    const local = frame - clip.visible.start;
    const face = boxAt(clip.framing.keys, clip.framing.faces, local);
    const drawn = face ? onCanvas(face, cropAt(clip.framing.keys, local), canvas) : null;
    if (drawn) faces.push(drawn);
  }
  return faces;
}

export interface CaptionFaceInput extends ReframeQaInput {
  /** The probe's caption boxes at each cue's middle frame. */
  readonly captions: readonly ProbedTextBox[];
  /** The preset's safe rect: a moved anchor stays inside it. */
  readonly safe: Rect;
}

export function captionCoversFaceCheck(input: CaptionFaceInput, durationMs = 0): QaCheckResult {
  const config = input.config ?? REFRAME_CONFIG;
  const cues = input.captions.filter((box) => box.kind === 'caption');
  if (cues.length === 0 || crops(input.clips).length === 0) return skipped('captionCoversFace', durationMs);
  const findings: QaFinding[] = [];
  let anchorY: number | null = null;
  for (const cue of cues) {
    const faces = facesOnCanvasAt(input.clips, cue.frame, input.canvas);
    if (!faces.some((face) => rectsOverlap(face, cue.box))) continue;
    findings.push(spanFinding({ start: cue.frame, end: cue.frame + 1 }, { kind: 'caption', id: cue.id }));
    const top: number | null =
      anchorY === null ? clearTop(cue.box, faces, input.safe, config.captionGapPx) : null;
    if (top !== null) anchorY = Math.round(((top + cue.box.height / 2) / input.canvas.height) * 1000) / 1000;
  }
  return checkResult(
    'captionCoversFace',
    findings.length > 0 ? 'fail' : 'pass',
    {
      measured: { value: findings.length, unit: 'count' },
      threshold: { max: 0, unit: 'count' },
      findings,
      fixes:
        anchorY === null
          ? []
          : [
              commandFix('qa.fixes.captionClearFace', CAPTION_COMMANDS.setStyle, {
                ...input.target,
                style: { anchorY },
              }),
            ],
    },
    durationMs,
  );
}
