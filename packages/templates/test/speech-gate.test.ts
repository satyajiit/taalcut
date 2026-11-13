// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-ACC: the speech gate rejects what Whisper writes over music that nobody says, and keeps what is said.
 * Made-up lines.
 */
import { describe, expect, it } from 'vitest';
import { BREAKDOWN_CONFIG } from '../src/breakdown/config';
import { gateSpeech } from '../src/breakdown/speech-gate';

const config = BREAKDOWN_CONFIG.speech;
const said = (text: string, startMs = 0, endMs = 2_000, confidence?: number) => ({
  startMs,
  endMs,
  text,
  ...(confidence === undefined ? {} : { confidence }),
});
const texts = (kept: readonly { text: string }[]) => kept.map((segment) => segment.text);

describe('gateSpeech', () => {
  it('rejects notes and music signs with nothing said', () => {
    const gated = gateSpeech(
      [said('[음악]'), said('(applause)'), said('♪ ♪'), said('[Music]')],
      { music: true },
      config,
    );
    expect(gated).toEqual({ kept: [], rejected: 4, doubt: false });
  });

  it('rejects Whisper looping, in a line or across lines', () => {
    const loop = said('go go go go');
    const repeated = [said('see you', 0, 900), said('see you', 1_000, 1_900), said('see you', 2_000, 2_900)];
    expect(texts(gateSpeech([loop, ...repeated], { music: false }, config).kept)).toEqual([]);
  });

  it('rejects the lines it invents from subtitle credits on music, not in speech', () => {
    const credit = said('Thanks for watching!');
    expect(gateSpeech([credit], { music: true }, config).kept).toEqual([]);
    expect(texts(gateSpeech([credit], { music: false }, config).kept)).toEqual(['Thanks for watching!']);
  });

  it('rejects a line the engine isn’t sure of, when it says so', () => {
    const gated = gateSpeech(
      [said('maybe words', 0, 900, 0.2), said('clear words', 1_000, 1_900, 0.9)],
      { music: false },
      config,
    );
    expect(texts(gated.kept)).toEqual(['clear words']);
  });

  it('rejects a line voice activity doesn’t back, when it is known', () => {
    const voice = [{ startMs: 1_000, endMs: 3_000 }];
    const gated = gateSpeech(
      [said('nobody here', 0, 900), said('somebody here', 1_100, 2_800)],
      { music: true, voice },
      config,
    );
    expect(texts(gated.kept)).toEqual(['somebody here']);
    expect(gated.doubt).toBe(false);
  });

  it('keeps speech on music without voice activity, with a doubt for the review', () => {
    const gated = gateSpeech([said('we made it to the top')], { music: true }, config);
    expect(gated).toMatchObject({ rejected: 0, doubt: true });
    expect(gateSpeech([said('we made it to the top')], { music: false }, config).doubt).toBe(false);
  });
});
