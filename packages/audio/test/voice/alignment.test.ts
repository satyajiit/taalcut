// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { FrameRate, newId, RationalTime, TimeRange, type SlotId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { alignWords, scaleAlignedLine, ttsTranscript } from '../../src/voice/alignment';
import { assignSlots, countWords, fitScript } from '../../src/voice/script-fit';

function timings(text: string, lead = 0.2, per = 0.05) {
  const characters = [...text];
  return {
    characters,
    startSeconds: characters.map((_, i) => lead + i * per),
    endSeconds: characters.map((_, i) => lead + (i + 1) * per),
  };
}
const ms = (t: RationalTime) => Math.round(RationalTime.toSeconds(t) * 1000);

describe('alignWords', () => {
  it('groups characters into words, drops audio tags and starts at the first word', () => {
    const line = alignWords(timings('[whispers] Hello, world.'), 'en');
    expect(line.words.map((w) => w.text)).toEqual(['Hello', 'world']);
    expect(ms(line.onset)).toBe(200 + 11 * 50);
    expect(ms(TimeRange.end(line.words[1]?.range ?? TimeRange.of(line.onset, line.onset)))).toBe(
      200 + 23 * 50,
    );
  });

  it('keeps Devanagari words whole', () => {
    const line = alignWords(timings('मेरा नाम आशा है'), 'hi');
    expect(line.words.map((w) => w.text)).toEqual(['मेरा', 'नाम', 'आशा', 'है']);
  });

  it('scales a line to a compressed file: every word sooner and shorter, on the same clock', () => {
    const line = alignWords(timings('One two'), 'en');
    const half = scaleAlignedLine(line, 0.5);
    expect(half.words.map((w) => w.text)).toEqual(['One', 'two']);
    expect(ms(half.onset)).toBe(100);
    expect(half.words.map((w) => [ms(w.range.start), ms(w.range.duration)])).toEqual([
      [100, 75],
      [200, 75],
    ]);
    expect(ms(half.speechEnd)).toBe(ms(line.speechEnd) / 2);
    expect(half.onset.rate).toEqual(line.onset.rate);
  });

  it('makes a tts transcript on the millisecond clock', () => {
    const transcript = ttsTranscript(alignWords(timings('One two'), 'en'), 'en', 'eleven_v4');
    expect(transcript.engine).toBe('tts');
    expect(
      transcript.segments[0]?.words.map((w) => [w.text, w.range.start.value, w.range.start.rate]),
    ).toEqual([
      ['One', 200, FrameRate.of(1000, 1)],
      ['two', 400, FrameRate.of(1000, 1)],
    ]);
  });
});

describe('fitScript', () => {
  const slots = [newId<'TemplateSlot'>(), newId<'TemplateSlot'>()] as SlotId[];
  const spans = [
    { slotId: slots[0] as SlotId, startFrame: 0, endFrame: 90 },
    { slotId: slots[1] as SlotId, startFrame: 90, endFrame: 180 },
  ];

  it('counts spoken words only and assigns free slots in order', () => {
    expect(countWords('[laughs] Hi there, friend!', 'en')).toBe(3);
    expect(assignSlots([{ text: 'a' }, { text: 'b', slotId: slots[1] }], spans)).toEqual([
      slots[0],
      slots[1],
    ]);
    expect(assignSlots([{ text: 'a', slotId: slots[1] }, { text: 'b' }], spans)).toEqual([slots[1], null]);
  });

  it('suggests a shorter line past 15 % over, with spill into an unvoiced next slot', () => {
    const fits = fitScript({
      lines: [
        { text: 'one two three four five six seven' },
        { text: Array.from({ length: 20 }, () => 'word').join(' ') },
      ],
      language: 'en',
      slots: spans,
      frameMs: 1000 / 30,
    });
    expect(fits[0]?.overByMs).toBe(0);
    expect(fits[1]?.overByMs).toBeGreaterThan(0);
    expect(fits[1]?.suggestedWords).toBe(8);
    const alone = fitScript({
      lines: [{ text: Array.from({ length: 10 }, () => 'word').join(' ') }],
      language: 'en',
      slots: spans,
      frameMs: 1000 / 30,
    });
    expect(alone[0]?.slotMs).toBe(4500);
    expect(alone[0]?.overByMs).toBe(0);
  });
});
