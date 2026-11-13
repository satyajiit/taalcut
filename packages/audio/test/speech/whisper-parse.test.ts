// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** whisper `-ojf`: millisecond offsets, byte-joined UTF-8, specials, and loop cuts. */
import { describe, expect, it } from 'vitest';
import { rangeToMs } from '../../src/rates';
import { parseWhisperJson, wordsFromTokens, type WhisperToken } from '../../src/speech/whisper-parse';

function token(text: string, fromMs: number, toMs: number, probability?: number): WhisperToken {
  return { text, fromMs, toMs, ...(probability === undefined ? {} : { probability }) };
}

describe('parseWhisperJson', () => {
  it('drops specials and starts a word on a leading space', () => {
    const parsed = parseWhisperJson({
      result: { language: 'en' },
      transcription: [
        {
          text: ' hello world',
          offsets: { from: 0, to: 500 },
          tokens: [
            { text: '[_BEG_]', offsets: { from: 0, to: 0 }, p: 0 },
            { text: ' hello', offsets: { from: 40, to: 280 }, p: 0.8 },
            { text: ' world', offsets: { from: 300, to: 500 }, p: 0.4 },
          ],
        },
      ],
    });
    expect(parsed.language).toBe('en');
    expect(parsed.loopTruncated).toBe(false);
    expect(parsed.words.map((word) => word.text)).toEqual(['hello', 'world']);
    expect(rangeToMs(parsed.words[0]!.range)).toEqual({ startMs: 40, endMs: 280 });
  });

  it('starts words at their DTW times when whisper ran DTW, each lasting until the next', () => {
    const parsed = parseWhisperJson({
      result: { language: 'en' },
      transcription: [
        {
          text: ' The old lighthouse.',
          offsets: { from: 0, to: 5200 },
          tokens: [
            { text: '[_BEG_]', offsets: { from: 0, to: 0 }, t_dtw: -1 },
            { text: ' The', offsets: { from: 0, to: 370 }, t_dtw: 210 },
            { text: ' old', offsets: { from: 370, to: 740 }, t_dtw: 238 },
            { text: ' lighthouse', offsets: { from: 1980, to: 1980 }, t_dtw: 270 },
            { text: '.', offsets: { from: 3990, to: 3990 }, t_dtw: 396 },
          ],
        },
      ],
    });
    expect(parsed.words.map((word) => [word.text, rangeToMs(word.range)])).toEqual([
      ['The', { startMs: 2100, endMs: 2380 }],
      ['old', { startMs: 2380, endMs: 2700 }],
      ['lighthouse.', { startMs: 2700, endMs: 3990 }],
    ]);
  });

  it('joins byte tokens before UTF-8 decode, including a U+2581 word start', () => {
    const bytes = [...new TextEncoder().encode(' नमस्ते')];
    const transcription = bytes.map((byte, index) => ({
      text: String.fromCharCode(byte),
      offsets: { from: index * 20, to: index * 20 + 20 },
      p: 0.7,
    }));
    const parsed = parseWhisperJson({
      result: { language: 'hi' },
      transcription: [
        { text: ' नमस्ते', offsets: { from: 0, to: bytes.length * 20 }, tokens: transcription },
      ],
    });
    expect(parsed.words).toHaveLength(1);
    expect(parsed.words[0]?.text).toBe('नमस्ते');

    const marker = wordsFromTokens([token('\u2581नमस्ते', 0, 120)]);
    expect(marker.words[0]?.text).toBe('नमस्ते');
    expect(marker.loopTruncated).toBe(false);
  });

  it('keeps two copies of a phrase repeated four times and flags the cut', () => {
    const tokens = Array.from({ length: 4 }, (_, index) => token(' ha', index * 100, index * 100 + 80));
    const parsed = wordsFromTokens(tokens);
    expect(parsed.loopTruncated).toBe(true);
    expect(parsed.words.map((word) => word.text)).toEqual(['ha', 'ha']);
  });

  it('treats a missing transcription as no words', () => {
    expect(parseWhisperJson({ result: { language: 'en' } })).toMatchObject({
      language: 'en',
      words: [],
      loopTruncated: false,
    });
    expect(parseWhisperJson(null).words).toEqual([]);
  });
});
