// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template's audio profile from the audio lane's measurements (SPEC
 * "Audio kind"): music when beats are confident and speech is rare, voice
 * when speech dominates and there are no beats, mixed when both, original
 * when neither but audible, silent under the loudness floor.
 */
import {
  FrameRate,
  RationalTime,
  type AudioProfile,
  type BeatMap,
  type TemplateListening,
} from '@taalcut/core';
import type { AudioKind } from '../types';
import type { BreakdownConfig } from './config';
import type { SpeechSegmentMs } from './ports';

const WAVEFORM_RATE = FrameRate.of(50);
const MAX_SEGMENTS = 400;
const MAX_PEAKS = 12_000;

/**
 * The beat tracker's onset envelope as a waveform, each 0–1 (REF1, gate finding 7). The envelope is raw spectral
 * flux, the sum of the rises over every mel band (audio's beats/graph.ts), so its values run into the tens; clamped
 * to 1 as they were, nearly every peak read 1 and the strip and the style profile's energy were flat. Scaled to its
 * loudest frame instead, as audio's classifier scales it (jobs/handlers.ts), it keeps its shape. All zero, or no
 * finite value, stays all zero.
 */
export function envelopeWaveform(envelope: readonly number[]): number[] {
  let max = 0;
  for (const value of envelope) if (Number.isFinite(value) && value > max) max = value;
  return envelope.map((value) => (max > 0 && Number.isFinite(value) && value > 0 ? value / max : 0));
}

export function classifyAudioKind(
  evidence: {
    readonly integratedLufs: number | null;
    readonly beatMap: BeatMap | null;
    /** Share of the duration with speech, 0–1. */
    readonly speech: number;
  },
  config: BreakdownConfig['audio'],
): AudioKind {
  if (evidence.integratedLufs === null || evidence.integratedLufs < config.silentLufs) return 'silent';
  const beats = evidence.beatMap !== null && evidence.beatMap.beats.length > 0;
  const confidentBeats = beats && evidence.beatMap!.confidence >= config.musicBeatConfidence;
  if (confidentBeats && evidence.speech < config.musicMaxSpeech) return 'music';
  if (!beats && evidence.speech >= config.voiceMinSpeech) return 'voice';
  if (beats && evidence.speech >= config.musicMaxSpeech) return 'mixed';
  if (!beats && evidence.speech > 0) return 'voice';
  return 'original';
}

/** Share of `durationMs` covered by speech, overlaps counted once. */
export function speechCoverage(segments: readonly SpeechSegmentMs[], durationMs: number): number {
  if (durationMs <= 0) return 0;
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  let covered = 0;
  let end = 0;
  for (const segment of sorted) {
    const start = Math.max(segment.startMs, end, 0);
    const stop = Math.min(segment.endMs, durationMs);
    if (stop > start) covered += stop - start;
    end = Math.max(end, stop);
  }
  return Math.min(1, covered / durationMs);
}

export function buildAudioProfile(input: {
  readonly integratedLufs: number | null;
  readonly beatMap: BeatMap | null;
  readonly speech: { readonly language: string | null; readonly segments: readonly SpeechSegmentMs[] } | null;
  readonly peaks: readonly number[] | null;
  readonly sound: { readonly title: string | null; readonly artist: string | null } | null;
  readonly durationMs: number;
  readonly config: BreakdownConfig['audio'];
  /** EAR1-C1: what the listening stage heard; absent when the analysers can't listen. */
  readonly listening?: TemplateListening | null;
}): AudioProfile {
  const segments = input.speech?.segments ?? [];
  const coverage = speechCoverage(segments, input.durationMs);
  const kind = classifyAudioKind(
    { integratedLufs: input.integratedLufs, beatMap: input.beatMap, speech: coverage },
    input.config,
  );
  const atMs = (ms: number) => RationalTime.fromSeconds(ms / 1000, FrameRate.of(1000));
  return {
    kind,
    loudnessLufs:
      kind === 'silent' || input.integratedLufs === null
        ? null
        : Math.min(5, Math.max(-70, input.integratedLufs)),
    sound: input.sound,
    speech:
      segments.length === 0
        ? null
        : {
            language: input.speech?.language ?? null,
            coverage,
            segments: segments
              .filter((segment) => segment.endMs > segment.startMs && segment.text.trim().length > 0)
              .slice(0, MAX_SEGMENTS)
              .map((segment) => ({
                start: atMs(segment.startMs),
                duration: atMs(segment.endMs - segment.startMs),
                text: segment.text.trim().slice(0, 1000),
              })),
          },
    waveform:
      input.peaks && input.peaks.length > 0
        ? {
            rate: WAVEFORM_RATE,
            peaks: input.peaks.slice(0, MAX_PEAKS).map((peak) => Math.min(1, Math.max(0, peak))),
          }
        : null,
    ...(input.listening !== undefined ? { listening: input.listening } : {}),
  };
}
