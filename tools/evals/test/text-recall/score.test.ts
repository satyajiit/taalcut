// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { baselineFrom, gateLine, gateOf, type TextBaseline } from '../../src/text-recall/baseline';
import type { StoredText } from '../../src/text-recall/library';
import { scoreLibrary } from '../../src/text-recall/score';
import { knownLines, textManifestSchema, tokensOf } from '../../src/text-recall/words';
import { MANIFEST } from './fixture';

const lines = knownLines(textManifestSchema.parse(MANIFEST));

const stored = (
  path: string,
  files: Record<string, { from: number; to: number; text: string }[]>,
): StoredText => ({
  path,
  files: new Map(
    Object.entries(files).map(([file, shots]) => [file, shots.map((shot, index) => ({ index, ...shot }))]),
  ),
  ocrRequests: 1,
});

const GOOD = stored('/runs/x/run-1/index-library.sqlite', {
  'a.mp4': [
    { from: 0, to: 2, text: '00:00:01.000' },
    { from: 2, to: 6, text: 'PIER 39 FERRY\n39 FERRY' },
    { from: 9, to: 12, text: 'PIER 1400' },
  ],
  'b.mov': [{ from: 0, to: 4, text: 'PHRK\nSKATE' }],
});

describe('the word rule', () => {
  it('upper-cases and splits on everything but letters and digits, Latin-1 and Devanagari included', () => {
    expect(tokensOf('Pier-39, ferry! 39')).toEqual(['PIER', '39', 'FERRY']);
    expect(tokensOf('Jardim Botânico — नमस्ते')).toEqual(['JARDIM', 'BOTÂNICO', 'नमस्ते']);
    expect(tokensOf('00:00:01.500')).toEqual(['00', '01', '500']);
  });

  it('takes each manifest line’s words, and none from clips without lines', () => {
    expect(lines.map((line) => [line.file, line.words])).toEqual([
      ['a.mp4', ['PIER', '39', 'FERRY']],
      ['b.mov', ['SKATE', 'PARK']],
    ]);
  });
});

describe('scoreLibrary', () => {
  it('reads a word only as a whole token of its own file’s text, and shows what was stored around the line', () => {
    const score = scoreLibrary(GOOD, lines);
    expect(score.found).toBe(4);
    expect(score.total).toBe(5);
    // PHRK is not PARK.
    expect(score.missed).toEqual(['b.mov:PARK']);
    expect(score.lines[0]).toMatchObject({ found: ['PIER', '39', 'FERRY'], missed: [] });
    // The shot that ends where the line starts (2 s) is around it, within the half-second slack; 9–12 s is not.
    expect(score.lines[0]?.read).toEqual(['00:00:01.000', 'PIER 39 FERRY', '39 FERRY']);
    expect(score.lines[1]?.read).toEqual(['PHRK', 'SKATE']);
  });

  it('does not read a word inside a longer token, nor from another file', () => {
    const only = stored('/l.sqlite', {
      'a.mp4': [{ from: 0, to: 9, text: 'PIERS 1395 SKATE PARK' }],
      'b.mov': [],
    });
    const score = scoreLibrary(only, lines);
    expect(score.found).toBe(0);
    expect(score.lines[1]?.read).toEqual([]);
  });
});

describe('the gate', () => {
  const baseline = (found: string[], minFound = 3): TextBaseline => ({
    v: 1,
    set: 'test-set',
    from: 'x',
    takenAt: '2026-10-20T00:00:00Z',
    minFound,
    total: 5,
    found,
  });

  it('passes at the floor with no baseline word lost, and names words read beyond the baseline', () => {
    const gate = gateOf(scoreLibrary(GOOD, lines), baseline(['a.mp4:PIER', 'a.mp4:39']), 3);
    expect(gate).toMatchObject({ pass: true, found: 4, lost: [], gained: ['a.mp4:FERRY', 'b.mov:SKATE'] });
    expect(gateLine('x/run-1', gate)).toBe(
      'gate: pass x/run-1: 4 of 5 read (floor 3), no baseline word lost; read beyond the baseline ' +
        'a.mp4:FERRY b.mov:SKATE',
    );
  });

  it('fails when a baseline word is lost even above the floor, and under the floor without a baseline', () => {
    const lost = gateOf(scoreLibrary(GOOD, lines), baseline(['b.mov:PARK']), 3);
    expect(lost).toMatchObject({ pass: false, lost: ['b.mov:PARK'] });
    expect(gateLine('y', { ...lost, gained: [] })).toBe(
      'gate: FAIL y: 4 of 5 read (floor 3), lost b.mov:PARK',
    );
    const floor = gateOf(scoreLibrary(GOOD, lines), null, 5);
    expect(floor.pass).toBe(false);
    expect(gateLine('z', floor)).toBe('gate: FAIL z: 4 of 5 read (floor 5), no baseline: floor only');
  });

  it('takes a baseline only from libraries that read the same words, at or over the floor', () => {
    const input = { set: 'test-set', from: 'x', takenAt: 't', minFound: 3 };
    const score = scoreLibrary(GOOD, lines);
    const written = baselineFrom([score, { ...score, path: '/other' }], input);
    expect(written.found).toEqual(['a.mp4:39', 'a.mp4:FERRY', 'a.mp4:PIER', 'b.mov:SKATE']);
    expect(written.total).toBe(5);
    // Its floor is the words read, not the floor they had to reach.
    expect(written.minFound).toBe(4);
    const fewer = scoreLibrary(
      stored('/fewer', { 'a.mp4': [{ from: 2, to: 6, text: 'PIER 39 FERRY' }] }),
      lines,
    );
    expect(() => baselineFrom([score, fewer], input)).toThrow(/read different words.*\/fewer only \[\]/);
    expect(() => baselineFrom([fewer], { ...input, minFound: 4 })).toThrow(/under the floor of 4/);
    expect(() => baselineFrom([], input)).toThrow(/at least one library/);
  });
});
