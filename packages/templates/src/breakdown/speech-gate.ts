// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The speech gate (BRK1, SPEC "Speech"). Whisper writes words over music that nobody says: at the REF1 gate, a
 * bracketed word over a quiet intro. A segment is rejected when:
 *
 * - nothing is left of it but bracketed or parenthesised notes and music signs ("[Music]", "(applause)", "♪");
 * - it is Whisper looping: the same words `repeats` times in a row, or the same line as two other segments;
 * - on music, it is one of the lines Whisper is known to invent from subtitle credits ("thanks for watching");
 * - the engine's mean word probability is under `minConfidence`, when it gives one;
 * - voice activity covers less than `minVoiceShare` of it, when voice activity is known.
 *
 * Speech that passes on a music reel without voice activity to back it is kept, with a doubt for the review.
 */
import type { BreakdownConfig } from './config';
import type { SpeechSegmentMs } from './ports';

/** Lines Whisper is known to produce from silence and music: subtitle credits and sign-offs, in many languages. */
const INVENTED = [
  /thank(s| you) for watching/i,
  /please subscribe|like and subscribe/i,
  /subtitles? by|captions? by|amara\.org/i,
  /ご視聴ありがとうございました/u,
  /시청해\s*주셔서\s*감사합니다/u,
  /字幕/u,
  /продолжение следует/iu,
  /sous-titr/i,
  /untertitel/i,
];

/** Bracketed and parenthesised notes, music signs and punctuation: what isn't words said. */
const NOTES = /\[[^\]]*\]|\([^)]*\)|【[^】]*】|（[^）]*）|[♪♫♬🎵🎶]/gu;
const words = (text: string) =>
  text
    .replace(NOTES, ' ')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word.length > 0);

/** The same run of one to four words `times` times in a row. */
function loops(said: readonly string[], times: number): boolean {
  for (let size = 1; size <= 4; size++)
    for (let start = 0; start + size * times <= said.length; start++) {
      const run = said.slice(start, start + size).join(' ');
      let count = 1;
      while (count < times && said.slice(start + count * size, start + (count + 1) * size).join(' ') === run)
        count++;
      if (count >= times) return true;
    }
  return false;
}

export interface SpeechEvidence {
  /** The reel's audio is music: a confident beat map. */
  readonly music: boolean;
  /** Voice activity in milliseconds, when it is known. */
  readonly voice?: readonly { readonly startMs: number; readonly endMs: number }[] | null;
}

export interface GatedSpeech {
  readonly kept: SpeechSegmentMs[];
  readonly rejected: number;
  /** Speech kept on music that voice activity didn't back: the review asks. */
  readonly doubt: boolean;
}

function voiceShare(segment: SpeechSegmentMs, voice: NonNullable<SpeechEvidence['voice']>): number {
  const length = segment.endMs - segment.startMs;
  if (length <= 0) return 0;
  let covered = 0;
  for (const region of voice)
    covered += Math.max(0, Math.min(segment.endMs, region.endMs) - Math.max(segment.startMs, region.startMs));
  return Math.min(1, covered / length);
}

export function gateSpeech(
  segments: readonly SpeechSegmentMs[],
  evidence: SpeechEvidence,
  config: BreakdownConfig['speech'],
): GatedSpeech {
  const lines = segments.map((segment) => words(segment.text).join(' '));
  const kept = segments.filter((segment, index) => {
    const said = words(segment.text);
    if (said.length === 0) return false;
    if (loops(said, config.repeats)) return false;
    if (lines.filter((line) => line === lines[index]).length >= 3) return false;
    if (evidence.music && INVENTED.some((pattern) => pattern.test(segment.text))) return false;
    if (segment.confidence !== undefined && segment.confidence < config.minConfidence) return false;
    if (evidence.voice && voiceShare(segment, evidence.voice) < config.minVoiceShare) return false;
    return true;
  });
  return {
    kept,
    rejected: segments.length - kept.length,
    doubt: kept.length > 0 && evidence.music && !evidence.voice,
  };
}
