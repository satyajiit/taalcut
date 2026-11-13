// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The on-screen-text recall gate (scripts/ocr-recall.ts): a word the baseline read and the run did not is lost,
 * and so is every word of a clip the run never profiled (IX2-F1: a partial run must not pass the gate).
 */
import { describe, expect, it } from 'vitest';
import { lostWords, type LineResult } from '../../scripts/ocr-recall-gate';

const line = (file: string, text: string, found: readonly string[]): LineResult => ({
  file,
  line: text,
  words: text.split(' '),
  found,
  read: [],
});

describe('lostWords', () => {
  const baseline = [line('a.mp4', 'BIG SALE', ['BIG', 'SALE']), line('b.mp4', 'OPEN NOW', ['OPEN'])];

  it('passes a run that reads every word the baseline read, and more', () => {
    const run = [line('a.mp4', 'BIG SALE', ['BIG', 'SALE']), line('b.mp4', 'OPEN NOW', ['OPEN', 'NOW'])];
    expect(lostWords(run, baseline)).toEqual([]);
  });

  it('names a word the run no longer reads', () => {
    const run = [line('a.mp4', 'BIG SALE', ['BIG']), line('b.mp4', 'OPEN NOW', ['OPEN'])];
    expect(lostWords(run, baseline)).toEqual(['a.mp4: SALE (BIG SALE)']);
  });

  it('counts a clip the run did not profile as lost, not as absent from the gate', () => {
    const run = [line('a.mp4', 'BIG SALE', ['BIG', 'SALE'])];
    expect(lostWords(run, baseline)).toEqual(['b.mp4: OPEN (OPEN NOW; not profiled)']);
    expect(lostWords([], baseline)).toHaveLength(3);
  });
});
