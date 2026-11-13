// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** IX2-U1: the study's labels come from the footage's plan, and every probe in the committed file resolves. */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evalQueryProbes, labelProbe, setOfAssets, studyProbes } from '../../../src/search/study/labels';
import { loadProbes, type StudyProbe } from '../../../src/search/study/schema';

const PROBES = fileURLToPath(new URL('../../../search-study/probes.json', import.meta.url));

const probe = (relevant: StudyProbe['relevant'], set: StudyProbe['set'] = 'ix-v1'): StudyProbe => ({
  id: 'p',
  set,
  language: 'en',
  kind: 'on-screen',
  text: 'x',
  relevant,
});

describe('study labels', () => {
  it('place on-screen lines and looks where ix-v1’s manifest says they are', () => {
    // manifest.json of ix-v1 (generated 2026-10-16): PIER 39 FERRY 22.8–25.8 s, TAKE 4 18–21 s, bars shots.
    expect(
      labelProbe(probe([{ clip: 'city-4k-hevc30-en.mov', onScreen: 'PIER 39 FERRY' }])).relevant,
    ).toEqual([{ asset: 'city-4k-hevc30-en.mov', range: { from: 22.8, to: 25.8 } }]);
    expect(labelProbe(probe([{ clip: 'studio-1080-h264-hi.mp4', onScreen: 'TAKE 4' }])).relevant).toEqual([
      { asset: 'studio-1080-h264-hi.mp4', range: { from: 18, to: 21 } },
    ]);
    const bars = labelProbe(probe([{ look: 'bars' }])).relevant;
    expect(bars.map((l) => l.asset).sort()).toEqual([
      'bike-4k-hevc60-music.mov',
      'garden-1080-hevc30-es.mov',
      'lake-1080-h264-silent.mp4',
    ]);
    expect(bars.find((l) => l.asset === 'bike-4k-hevc60-music.mov')?.range).toEqual({ from: 8.5, to: 14 });
  });

  it('allow a whole clip for on-screen words only when the clip also says them', () => {
    expect(labelProbe(probe([{ clip: 'kitchen-1080-h264-en.mp4', spokenToo: 'Garlic' }])).relevant).toEqual([
      { asset: 'kitchen-1080-h264-en.mp4' },
    ]);
    expect(() => labelProbe(probe([{ clip: 'kitchen-1080-h264-en.mp4', spokenToo: 'pasta' }]))).toThrow(
      /p: kitchen-1080-h264-en.mp4 doesn't say "pasta"/,
    );
    expect(() => labelProbe(probe([{ clip: 'concert-4k-hevc30-music.mov', onScreen: 'TAKE 4' }]))).toThrow(
      /never shows/,
    );
    expect(() => labelProbe(probe([{ clip: 'nope.mov' }]))).toThrow(/ix-v1 has no clip nope.mov/);
  });

  it('name whole clips in the search eval’s library, and take its eight queries as they are', () => {
    expect(labelProbe(probe([{ clip: 'clips/desk.mkv' }], 'synthetic-search')).relevant).toEqual([
      { asset: 'clips/desk.mkv' },
    ]);
    expect(() => labelProbe(probe([{ look: 'bars' }], 'synthetic-search'))).toThrow(/whole clips/);
    const evals = evalQueryProbes();
    expect(evals).toHaveLength(8);
    expect(evals[0]).toMatchObject({
      id: 'eval-en-market',
      text: 'the market stall',
      relevant: [{ asset: 'clips/en-market.mkv' }],
    });
  });

  it('resolve every committed probe, in all four languages and every kind', () => {
    const probes = studyProbes(loadProbes(PROBES));
    expect(new Set(probes.map((p) => p.language))).toEqual(new Set(['en', 'hi', 'es', 'pt-BR']));
    expect(new Set(probes.filter((p) => p.set === 'ix-v1').map((p) => p.kind))).toEqual(
      new Set(['speech', 'on-screen', 'visual', 'description']),
    );
    // The bench's probe words and the desktop e2e's SPOKEN words are all in it.
    for (const word of ['lighthouse', 'मानसून', 'biblioteca', 'cachoeira'])
      expect(probes.some((p) => p.kind === 'speech' && p.text === word)).toBe(true);
    expect(probes.every((p) => p.relevant.length > 0)).toBe(true);
  });

  it('tell a stored library’s set from its assets', () => {
    expect(setOfAssets(['market-4k-hevc30-hi.mov', 'city-4k-hevc30-en.mov'])).toBe('ix-v1');
    expect(setOfAssets(['clips/en-market.mkv'])).toBe('synthetic-search');
    expect(() => setOfAssets(['market-4k-hevc30-hi.mov', 'clips/en-market.mkv'])).toThrow(/neither/);
  });
});
