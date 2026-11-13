// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Shared pieces of the QA suites: a QaPlan builder, a glyph checker stand-in, the pass-fixture encode recipe, and
 * defaults for runQa's input.
 */
import {
  FrameRate,
  newId,
  type CaptionTrack,
  type ProjectId,
  type QaCheckResult,
  type QaReport,
  type TimelineId,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { GlyphChecker, QaTarget } from '../../src/qa/checks/captions';
import { presetFor } from '../../src/presets/presets.v1';
import type { RunQaInput } from '../../src/qa/run-qa';
import type { QaPlan } from '../../src/types';
import { verdictOf } from '../../src/qa/verdict';
import { ffmpeg } from '../support/media';
import { FIXTURE_H264 } from '../support/host-video';

export const target: QaTarget = {
  projectId: newId<'Project'>() as ProjectId,
  timelineId: newId<'Timeline'>() as TimelineId,
};

export function qaPlan(overrides: Partial<QaPlan> = {}): QaPlan {
  const durationFrames = overrides.durationFrames ?? 60;
  return {
    version: 1,
    rateNum: 30,
    rateDen: 1,
    durationFrames,
    width: 1080,
    height: 1920,
    cuts: [],
    anchors: [],
    intendedDark: [],
    intendedStatic: [],
    clips: [{ id: 'clip-a', span: { start: 0, end: durationFrames }, fit: 'cover' }],
    cues: [],
    texts: [],
    audio: { silent: false, music: 'platformSound', referenceAudio: false, windows: [] },
    ...overrides,
  };
}

/** Scripts no curated font covers (Tamil, Arabic): what the captions module's cmap check reports for them. */
export const glyphStub: GlyphChecker = (cues) =>
  cues.flatMap((cue) => {
    const missing = [...cue.text]
      .map((char) => char.codePointAt(0)!)
      .filter((point) => (point >= 0x0b80 && point <= 0x0bff) || (point >= 0x0600 && point <= 0x06ff));
    return missing.length > 0 ? [{ cueId: cue.id, codepoints: missing }] : [];
  });

/** The pass recipe of docs/qa-gate.md: H.264 High (FIXTURE_H264), BT.709 tags, AAC, faststart. */
export const PASS_VIDEO = [
  '-c:v',
  FIXTURE_H264,
  // OpenH264 writes Constrained Baseline unless asked; VideoToolbox's default is High already.
  '-profile:v',
  'high',
  '-b:v',
  '8M',
  '-pix_fmt',
  'yuv420p',
  '-color_primaries',
  'bt709',
  '-color_trc',
  'bt709',
  '-colorspace',
  'bt709',
  '-color_range',
  'tv',
  // The encoders don't write the VUI colour tags themselves; the finishing stage sets them the same way.
  '-bsf:v',
  'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',
] as const;
export const PASS_AUDIO = ['-c:a', 'aac', '-ar', '48000', '-ac', '2'] as const;

/** testsrc2 picture with a tone, `seconds` long, at `size`, the pass recipe unless `extra` changes it. */
export async function passFixture(
  ctx: MediaContext,
  out: string,
  options: {
    seconds?: number;
    size?: string;
    rate?: string;
    extra?: readonly string[];
    faststart?: boolean;
  } = {},
): Promise<void> {
  const seconds = options.seconds ?? 2;
  await ffmpeg(ctx, [
    '-f',
    'lavfi',
    '-i',
    `testsrc2=s=${options.size ?? '1080x1920'}:r=${options.rate ?? '30'}:d=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=f=440:r=48000:d=${seconds}`,
    ...PASS_VIDEO,
    ...PASS_AUDIO,
    ...(options.extra ?? []),
    ...(options.faststart === false ? [] : ['-movflags', '+faststart']),
    out,
  ]);
}

export const rate30 = FrameRate.of(30);

/** runQa's input with nothing to probe, nothing to compare and no captions. */
export function runInput(file: string, plan: QaPlan, overrides: Partial<RunQaInput> = {}): RunQaInput {
  return {
    renderId: newId<'Render'>(),
    round: 1,
    file,
    plan,
    preset: presetFor('device'),
    target,
    captions: null,
    glyphIssues: glyphStub,
    ...overrides,
  };
}

export const clock = { now: () => 1_760_000_000_000 };

/** A caption track with given cue frames and texts at 30 fps. */
export function captions(
  cues: readonly {
    readonly id: string;
    readonly start: number;
    readonly frames: number;
    readonly text: string;
  }[],
  style: Partial<CaptionTrack['style']> = {},
): CaptionTrack {
  const rate = rate30;
  const at = (value: number) => ({ value, rate });
  return {
    enabled: true,
    language: 'en',
    styleSource: 'preset',
    style: {
      version: 1,
      font: 'notoSans',
      weight: 700,
      sizePx: 72,
      textColor: '#ffffff',
      highlightColor: '#ffd400',
      stroke: null,
      background: null,
      highlight: 'none',
      letterCase: 'asIs',
      anchorY: 0.55,
      maxLines: 2,
      maxWords: 6,
      ...style,
    },
    cues: cues.map((cue) => ({
      id: cue.id as never,
      range: { start: at(cue.start), duration: at(cue.frames) },
      words: [{ text: cue.text, range: { start: at(cue.start), duration: at(cue.frames) }, confidence: 1 }],
      edited: false,
    })),
  };
}

/** A report over `checks` whose verdict is what verdictOf says, unless `fields` says otherwise. */
export function report(checks: readonly QaCheckResult[], fields: Partial<QaReport> = {}): QaReport {
  const overrides = fields.overrides ?? [];
  return {
    version: 1,
    renderId: newId<'Render'>(),
    round: 1,
    verdict: verdictOf(checks, overrides),
    presetId: 'device',
    checks: [...checks],
    overrides,
    createdAt: clock.now(),
    ...fields,
  };
}
