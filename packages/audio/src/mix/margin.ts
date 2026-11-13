// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The voice-over-music check (SPEC P3.5, "Check"), pure over the two short-term series: S (3 s, ungated) of the
 * dry voice and of the ducked music, every 100 ms. Short-term loudness is ungated, so a half-silent window would
 * fail on silence: a frame counts only when voice covers at least 1.5 s of its 3 s window. Pass when every
 * counted frame has S_voice − S_music ≥ marginLu (LU are K-weighted; this is not a peak or RMS dB difference).
 * Frames in the first 3 s aren't counted: FFmpeg reports no short-term value until its window is full.
 */
import type { VoiceOverMusicReport } from '@taalcut/core';
import { MIX_CONFIG } from './config';
import { voicedMsIn, type Window } from './voice-activity';

export interface MarginInput {
  readonly voiceShortTerm: readonly number[];
  readonly musicShortTerm: readonly number[];
  readonly windows: readonly Window[];
  readonly marginLu: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export interface MarginResult {
  readonly report: VoiceOverMusicReport;
  /** Frames under the margin, for the planner's second pass. */
  readonly failingFrames: readonly number[];
}

export function checkMargin(input: MarginInput): MarginResult {
  const hop = MIX_CONFIG.hopMs;
  const frames = Math.min(input.voiceShortTerm.length, input.musicShortTerm.length);
  const counted: { atMs: number; voiceLufs: number; musicLufs: number; margin: number; frame: number }[] = [];
  for (let k = 0; k < frames; k++) {
    const endMs = (k + 1) * hop;
    if (endMs < MIX_CONFIG.check.windowMs) continue;
    const voicedMs = voicedMsIn(input.windows, endMs - MIX_CONFIG.check.windowMs, endMs);
    if (voicedMs < MIX_CONFIG.check.minVoicedMs) continue;
    const voiceLufs = input.voiceShortTerm[k] ?? MIX_CONFIG.envelope.silenceLufs;
    const musicLufs = input.musicShortTerm[k] ?? MIX_CONFIG.envelope.silenceLufs;
    counted.push({ atMs: endMs, voiceLufs, musicLufs, margin: voiceLufs - musicLufs, frame: k });
  }
  const sorted = [...counted].sort((a, b) => a.margin - b.margin);
  const failing = counted.filter((c) => c.margin < input.marginLu);
  const report: VoiceOverMusicReport = {
    frames,
    counted: counted.length,
    marginLu: input.marginLu,
    minMarginLu: sorted[0] ? round2(sorted[0].margin) : null,
    worst: sorted.slice(0, MIX_CONFIG.check.worst).map((c) => ({
      atMs: c.atMs,
      voiceLufs: round2(c.voiceLufs),
      musicLufs: round2(c.musicLufs),
    })),
    passed: failing.length === 0,
  };
  return { report, failingFrames: failing.map((c) => c.frame) };
}
