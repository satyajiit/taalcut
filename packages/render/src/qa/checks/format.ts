// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * File-format checks (docs/qa-gate.md, "File format" and "duration"): pure
 * functions of the stream facts, the QA plan and the preset.
 */
import { FrameRate, TIMELINE_COMMANDS, type ExportPreset, type QaCheckResult } from '@taalcut/core';
import { videoBitrateKbps } from '../../presets/presets.v1';
import { h264NeedsLevel52 } from '../../presets/h264-level';
import type { QaPlan } from '../../types';
import { parseRatio, type StreamFact, type StreamFacts } from '../measure/stream-facts';
import { agentFix, autoFix, checkResult, commandFix, type QaFinding, type QaTarget } from '../result';
import { QA_THRESHOLDS } from '../thresholds.v1';

const file = (id: string): QaFinding['target'] => ({ kind: 'file', id });
const problem = (id: string, value = 1): QaFinding => ({
  target: file(id),
  measured: { value, unit: 'count' },
});

function verdict(
  id: Parameters<typeof checkResult>[0],
  problems: QaFinding[],
  fix: ReturnType<typeof autoFix>,
) {
  return checkResult(
    id,
    problems.length === 0 ? 'pass' : 'fail',
    { measured: { value: problems.length, unit: 'count' }, findings: problems, fixes: [fix] },
    0,
  );
}

export function containerCheck(facts: StreamFacts): QaCheckResult {
  const problems: QaFinding[] = [];
  if (!facts.formatName.split(',').includes('mp4')) problems.push(problem('format'));
  if (facts.video.length !== 1) problems.push(problem('videoStreams', facts.video.length));
  if (facts.audio.length !== 1) problems.push(problem('audioStreams', facts.audio.length));
  if (!facts.faststart) problems.push(problem('faststart'));
  const tolerance = QA_THRESHOLDS.container.startToleranceMs / 1000;
  for (const [name, stream] of [
    ['videoStart', facts.video[0]],
    ['audioStart', facts.audio[0]],
  ] as const) {
    const start = stream?.startTime ?? 0;
    if (Math.abs(start) > tolerance)
      problems.push({ target: file(name), measured: { value: Math.round(start * 1000), unit: 'ms' } });
  }
  return verdict('container', problems, autoFix('remux'));
}

/**
 * What each codec's export must be (8-bit SDR): H.264 High within its output level; HEVC Main tagged `hvc1` (Apple's
 * players need it); AV1 Main (8-bit 4:2:0) in an `av01` sample entry (LNX1-AV1). The preset's `video.codec` is the
 * codec the export was asked for (the request's choice, render.presetInCodec).
 */
function videoCodecProblems(video: StreamFact | undefined, preset: ExportPreset): QaFinding[] {
  const problems: QaFinding[] = [];
  const codec = preset.video.codec;
  if (video?.codec !== codec) problems.push(problem('videoCodec'));
  if (codec === 'h264') {
    if (video?.profile !== 'High') problems.push(problem('profile'));
    const maxLevel = preset.width * preset.height > 1920 * 1080 ? 52 : QA_THRESHOLDS.codec.maxH264Level;
    if ((video?.level ?? Infinity) > maxLevel) problems.push(problem('level', video?.level ?? 0));
    const rate = parseRatio(video?.avgFrameRate);
    const width = video?.width ?? preset.width;
    const height = video?.height ?? preset.height;
    if (width * height > 1920 * 1080 && !rate) problems.push(problem('levelFrameRate'));
    if (rate && h264NeedsLevel52(width, height, FrameRate.of(rate[0], rate[1])) && (video?.level ?? 0) < 52)
      problems.push(problem('level', video?.level ?? 0));
    return problems;
  }
  if (video?.profile !== 'Main') problems.push(problem('profile'));
  if (video?.tag !== (codec === 'hevc' ? 'hvc1' : 'av01')) problems.push(problem('tag'));
  return problems;
}

export function codecCheck(facts: StreamFacts, preset: ExportPreset): QaCheckResult {
  const video = facts.video[0];
  const audio = facts.audio[0];
  const problems = videoCodecProblems(video, preset);
  if (video?.pixFmt !== 'yuv420p') problems.push(problem('pixelFormat'));
  // VideoToolbox leaves field_order unset on progressive output; only an interlaced flag fails.
  if (video?.fieldOrder && !['progressive', 'unknown'].includes(video.fieldOrder))
    problems.push(problem('fieldOrder'));
  if (video?.colorPrimaries !== 'bt709') problems.push(problem('colorPrimaries'));
  if (video?.colorTransfer !== 'bt709') problems.push(problem('colorTransfer'));
  if (video?.colorSpace !== 'bt709') problems.push(problem('colorSpace'));
  if (video?.colorRange !== 'tv') problems.push(problem('colorRange'));
  if (audio?.codec !== 'aac' || audio.profile !== 'LC') problems.push(problem('audioCodec'));
  if (audio?.sampleRate !== preset.audio.sampleRate)
    problems.push(problem('sampleRate', audio?.sampleRate ?? 0));
  if (audio?.channels !== preset.audio.channels) problems.push(problem('channels', audio?.channels ?? 0));
  return verdict('codec', problems, autoFix('reencode'));
}

export function resolutionCheck(facts: StreamFacts, plan: QaPlan): QaCheckResult {
  const video = facts.video[0];
  const problems =
    video?.width === plan.width && video.height === plan.height
      ? []
      : [{ target: file('resolution'), measured: { value: video?.width ?? 0, unit: 'px' as const } }];
  return verdict('resolution', problems, autoFix('rerender'));
}

export function aspectRatioCheck(facts: StreamFacts, plan: QaPlan): QaCheckResult {
  const video = facts.video[0];
  const problems: QaFinding[] = [];
  const sar = parseRatio(video?.sar);
  if (sar && sar[0] !== sar[1]) problems.push(problem('sampleAspectRatio'));
  const dar =
    parseRatio(video?.dar) ?? (video?.width && video.height ? [video.width, video.height] : undefined);
  if (!dar || dar[0] * plan.height !== dar[1] * plan.width) problems.push(problem('displayAspectRatio'));
  if ((video?.rotation ?? 0) % 360 !== 0) problems.push(problem('rotation', video?.rotation ?? 0));
  // Wrong pixels need a new render; wrong side data (rotation, SAR) only a remux.
  const pixels = video?.width === plan.width && video.height === plan.height;
  return verdict('aspectRatio', problems, autoFix(pixels ? 'remux' : 'rerender'));
}

export function frameRateCheck(facts: StreamFacts, plan: QaPlan): QaCheckResult {
  const video = facts.video[0];
  const expected = FrameRate.of(plan.rateNum, plan.rateDen);
  const problems: QaFinding[] = [];
  for (const [name, text] of [
    ['rFrameRate', video?.rFrameRate],
    ['avgFrameRate', video?.avgFrameRate],
  ] as const) {
    const ratio = parseRatio(text);
    if (!ratio || !FrameRate.equals(FrameRate.of(ratio[0], ratio[1]), expected)) problems.push(problem(name));
  }
  const frames = video?.packets ?? 0;
  if (frames !== plan.durationFrames)
    problems.push({ target: file('frameCount'), measured: { value: frames, unit: 'frames' } });
  return verdict('frameRate', problems, autoFix('rerender'));
}

export function bitrateCheck(facts: StreamFacts, preset: ExportPreset, plan: QaPlan): QaCheckResult {
  const target = videoBitrateKbps(preset, FrameRate.of(plan.rateNum, plan.rateDen));
  const measured = Math.round((facts.video[0]?.bitRate ?? 0) / 1000);
  const { tolerance } = QA_THRESHOLDS.bitrate;
  const min = Math.round(target * (1 - tolerance));
  const max = Math.round(target * (1 + tolerance));
  const inside = measured >= min && measured <= max;
  return checkResult(
    'bitrate',
    inside ? 'pass' : 'warn',
    {
      measured: { value: measured, unit: 'kbps' },
      threshold: { min, max, unit: 'kbps' },
      fixes: [autoFix('reencode')],
    },
    0,
  );
}

/**
 * The duration rule on a frame count: the preset's range, and exactly the timeline's frames. Too long is
 * fixed by the timeline itself (`timeline.trimToDuration` to the preset's maximum); too short needs footage.
 */
export function durationResult(
  frames: number,
  plan: QaPlan,
  preset: ExportPreset,
  target: QaTarget,
): QaCheckResult {
  const seconds = (frames * plan.rateDen) / plan.rateNum;
  const { minSeconds, maxSeconds } = preset.duration;
  const tooLong = seconds > maxSeconds;
  const tooShort = seconds < minSeconds;
  const mismatch = frames !== plan.durationFrames;
  const fixes = [
    ...(tooLong
      ? [commandFix('qa.fixes.trimToDuration', TIMELINE_COMMANDS.trimToDuration, { ...target, maxSeconds })]
      : []),
    ...(tooShort ? [agentFix('qa.fixes.lengthen', { minSeconds })] : []),
    ...(mismatch ? [autoFix('rerender')] : []),
  ];
  const findings: QaFinding[] = mismatch
    ? [{ target: file('frameCount'), measured: { value: frames - plan.durationFrames, unit: 'frames' } }]
    : [];
  return checkResult(
    'duration',
    tooLong || tooShort || mismatch ? 'fail' : 'pass',
    {
      measured: { value: Math.round(seconds * 1000) / 1000, unit: 'seconds' },
      threshold: { min: minSeconds, max: maxSeconds, unit: 'seconds' },
      findings,
      fixes,
      // "Export anyway" only for a render that is too short; never one too long or with lost frames.
      overridable: tooShort && !tooLong && !mismatch,
    },
    0,
  );
}

/** The same rule at preflight, from the timeline, before anything renders. */
export function durationPreflight(plan: QaPlan, preset: ExportPreset, target: QaTarget): QaCheckResult {
  return durationResult(plan.durationFrames, plan, preset, target);
}

export function durationCheck(
  facts: StreamFacts,
  plan: QaPlan,
  preset: ExportPreset,
  target: QaTarget,
): QaCheckResult {
  return durationResult(facts.video[0]?.packets ?? 0, plan, preset, target);
}

export function formatChecks(
  facts: StreamFacts,
  plan: QaPlan,
  preset: ExportPreset,
  target: QaTarget,
): QaCheckResult[] {
  return [
    containerCheck(facts),
    codecCheck(facts, preset),
    resolutionCheck(facts, plan),
    aspectRatioCheck(facts, plan),
    frameRateCheck(facts, plan),
    durationCheck(facts, plan, preset, target),
    bitrateCheck(facts, preset, plan),
  ];
}
