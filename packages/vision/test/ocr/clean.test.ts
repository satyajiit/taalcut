// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Cleaning a shot's on-screen text (LIB1-FIX, clean.ts). Synthetic reads shaped like what a phone clip stores at a
 * sample a second: a two-line shirt print on people moving, misread a different way each sample. And Hindi
 * captions, which must keep every word.
 */
import { describe, expect, it } from 'vitest';
import { scriptOf } from '../../src/ocr/text';
import { FrameRate, RationalTime, TimeRange, type OnScreenText } from '@taalcut/core';
import { cleanShotText } from '../../src/ocr/clean';

/** A phone clip's grid with variable frame timing (an average of 28.91 fps), a sample every 29 frames. */
const RATE = FrameRate.of(2_891, 100);
const EVERY = 29;

function read(
  text: string,
  frame: number,
  confidence: number,
  [x, y, width, height]: readonly [number, number, number, number],
  frames = 1,
  rate = RATE,
): OnScreenText {
  return {
    text,
    box: { x, y, width, height },
    range: TimeRange.of(RationalTime.of(frame, rate), RationalTime.of(frames, rate)),
    confidence,
    script: scriptOf(text),
    reveal: 'none',
  };
}

const words = (texts: readonly OnScreenText[]) => texts.map((t) => t.text);

/**
 * A "TIGER TEAM" print on dancers' shirts, one sample each: low-confidence misreads seen once, a stray letter
 * beside the word, the lower line missed or misread, and a second shirt across the frame.
 */
const TIGER_TEAM = [
  read('tlger', 0, 0.3, [0.6, 0.36, 0.09, 0.03]),
  read('TIGFR', 0, 0.3, [0.3, 0.4, 0.11, 0.04]),
  read('TIGER P', 29, 1, [0.58, 0.34, 0.11, 0.04]),
  read('TIGFR', 58, 1, [0.58, 0.4, 0.09, 0.03]),
  read('TFAM', 58, 0.3, [0.58, 0.43, 0.08, 0.03]),
  read('TIGER', 116, 1, [0.6, 0.27, 0.08, 0.03]),
  read('TEAM', 116, 1, [0.6, 0.3, 0.07, 0.03]),
  read('TIGER', 116, 1, [0.05, 0.3, 0.11, 0.05]),
  read('TIGEN', 145, 1, [0.57, 0.33, 0.07, 0.03]),
  read('（27', 145, 0.3, [0.57, 0.36, 0.05, 0.02]),
  read('TIGERI', 174, 1, [0.39, 0.43, 0.08, 0.02]),
  read('TEAM', 174, 1, [0.39, 0.45, 0.07, 0.02]),
];

describe('cleanShotText', () => {
  it('reads a shirt print as one clean line, over every sample that showed it', () => {
    const cleaned = cleanShotText(TIGER_TEAM, EVERY);
    expect(words(cleaned)).toEqual(['TIGER TEAM']);
    // From the first sample that read part of it to one frame after the last.
    expect(cleaned[0]!.range.start.value).toBe(29);
    expect(TimeRange.end(cleaned[0]!.range).value).toBe(175);
    expect(cleaned[0]!.confidence).toBe(1);
    expect(cleaned[0]!.script).toBe('latin');
  });

  it('reads it as one line at 30 fps too, where each read garbles a different word', () => {
    const at30 = (text: string, frame: number, confidence: number, box: [number, number, number, number]) =>
      read(text, frame, confidence, box, 1, FrameRate.of(30));
    const reads = [
      at30('TIGFR', 0, 0.3, [0.3, 0.4, 0.11, 0.04]),
      at30('tlger', 0, 0.3, [0.6, 0.36, 0.09, 0.03]),
      at30('TIGER P', 30, 1, [0.58, 0.34, 0.11, 0.04]),
      at30('TEAM', 30, 1, [0.58, 0.38, 0.08, 0.04]),
      at30('TIGER', 60, 1, [0.58, 0.4, 0.09, 0.03]),
      at30('TEAM', 60, 1, [0.58, 0.43, 0.09, 0.03]),
      at30('TlCDR', 120, 0.3, [0.05, 0.3, 0.1, 0.04]),
      at30('TLGEN', 120, 0.5, [0.58, 0.26, 0.09, 0.03]),
      at30('TEAM', 120, 1, [0.58, 0.29, 0.08, 0.03]),
      at30('TIGEV D', 150, 1, [0.57, 0.32, 0.1, 0.03]),
      at30('TEA', 150, 1, [0.57, 0.35, 0.05, 0.02]),
      at30('TIGER', 180, 1, [0.4, 0.42, 0.08, 0.03]),
      at30('TEAM', 180, 1, [0.4, 0.45, 0.08, 0.02]),
    ];
    const cleaned = cleanShotText(reads, 30);
    expect(words(cleaned)).toEqual(['TIGER TEAM']);
    expect(cleaned[0]!.range.start.value).toBe(30);
    expect(TimeRange.end(cleaned[0]!.range).value).toBe(181);
  });

  it('keeps two phrases apart when a word differs too much, even beside one that agrees', () => {
    const texts = [
      read('BIG SALE', 0, 1, [0.1, 0.1, 0.3, 0.05], 30),
      read('BIG DEAL', 116, 1, [0.1, 0.1, 0.3, 0.05], 30),
    ];
    expect(words(cleanShotText(texts, EVERY))).toEqual(['BIG SALE', 'BIG DEAL']);
  });

  it('keeps a logo and a sign, and drops what texture read once at low confidence', () => {
    // A sample every 30 frames at 30 fps: a boat's logo read twice, a sign with diacritics, and water read as text.
    const boat = [
      read('-HARBOR-', 30, 1, [0.8, 0.9, 0.1, 0.08], 1, FrameRate.of(30)),
      read('IRTLA', 90, 0.3, [0.65, 0.65, 0.03, 0.03], 1, FrameRate.of(30)),
      read('⑦7', 90, 0.3, [0.58, 0.65, 0.05, 0.03], 1, FrameRate.of(30)),
      read('- HARBOR-', 90, 1, [0.42, 0.89, 0.07, 0.08], 1, FrameRate.of(30)),
      read('-00080R', 90, 0.3, [0.45, 0.9, 0.08, 0.09], 1, FrameRate.of(30)),
      read('PÃO DE QUEIJO', 120, 0.5, [0.3, 0.57, 0.26, 0.06], 1, FrameRate.of(30)),
    ];
    expect(words(cleanShotText(boat, 30))).toEqual(['-HARBOR-', 'PÃO DE QUEIJO']);
  });

  it('drops lone junk: low confidence, or under three letters without a digit; keeps a lone number', () => {
    const texts = [
      read('Ci', 0, 1, [0.1, 0.1, 0.05, 0.03]),
      read('ok', 29, 1, [0.1, 0.5, 0.05, 0.03]),
      read('24', 29, 1, [0.5, 0.5, 0.05, 0.03]),
      read('SALE', 58, 1, [0.5, 0.8, 0.1, 0.03]),
      read('OPEN', 58, 0.3, [0.1, 0.8, 0.1, 0.03]),
    ];
    expect(words(cleanShotText(texts, EVERY))).toEqual(['24', 'SALE']);
  });

  it('keeps a low-confidence text it saw in several samples, unless a confident read covers it', () => {
    const steady = read('Handmade', 0, 0.3, [0.1, 0.1, 0.2, 0.05], 59);
    expect(words(cleanShotText([steady], EVERY))).toEqual(['Handmade']);
    const misread = read('Handrnade', 0, 0.3, [0.1, 0.1, 0.2, 0.05], 59);
    const sure = read('Handmade', 29, 1, [0.11, 0.1, 0.2, 0.05], 30);
    expect(words(cleanShotText([misread, sure], EVERY))).toEqual(['Handmade']);
    // Far from a confident read in time, a low-confidence text seen more than once is not covered: it stays.
    const later = read('Ocean', 400, 0.3, [0.11, 0.1, 0.2, 0.05], 59);
    expect(words(cleanShotText([sure, later], EVERY))).toEqual(['Handmade', 'Ocean']);
  });

  it('keeps a two-line Hindi caption whole, as one text, and a short Hindi word seen more than once', () => {
    const texts = [
      read('आज हम बनाएंगे', 0, 0.94, [0.2, 0.7, 0.6, 0.05], 88),
      read('स्वादिष्ट पनीर टिक्का', 0, 0.91, [0.18, 0.76, 0.64, 0.05], 88),
      read('है', 116, 0.97, [0.45, 0.1, 0.06, 0.05], 59),
      read('नमस्ते', 203, 0.96, [0.4, 0.4, 0.2, 0.06]),
    ];
    const cleaned = cleanShotText(texts, EVERY);
    expect(words(cleaned)).toEqual(['आज हम बनाएंगे स्वादिष्ट पनीर टिक्का', 'है', 'नमस्ते']);
    expect(cleaned.every((t) => t.script === 'devanagari')).toBe(true);
    // Three letters as written (न, म, स्ते): a lone नमस्ते is a word, not junk.
    expect(words(cleanShotText([read('नमस्ते', 0, 0.96, [0.4, 0.4, 0.2, 0.06])], EVERY))).toEqual(['नमस्ते']);
  });

  it('keeps captions that follow each other as separate texts, and a Hinglish line beside its Hindi', () => {
    const texts = [
      read('Welcome back to the kitchen', 0, 1, [0.1, 0.8, 0.8, 0.05], 59),
      read('Today: paneer tikka', 87, 1, [0.1, 0.8, 0.8, 0.05], 59),
      read('पनीर टिक्का', 87, 0.92, [0.3, 0.1, 0.4, 0.06], 59),
    ];
    expect(words(cleanShotText(texts, EVERY))).toEqual([
      'Welcome back to the kitchen',
      'पनीर टिक्का',
      'Today: paneer tikka',
    ]);
  });

  it('merges spellings of one text across the shot, case and a misread digit aside, never two numbers', () => {
    const texts = [
      read('Big Sale', 0, 1, [0.1, 0.1, 0.3, 0.05], 30),
      read('BIG SALE', 116, 1, [0.5, 0.5, 0.3, 0.05], 30),
      read('BIG SA1E', 203, 1, [0.5, 0.5, 0.3, 0.05]),
      read('Day 1', 0, 1, [0.1, 0.9, 0.1, 0.03], 30),
      read('Day 2', 116, 1, [0.1, 0.9, 0.1, 0.03], 30),
    ];
    expect(words(cleanShotText(texts, EVERY))).toEqual(['Big Sale', 'Day 1', 'Day 2']);
  });

  it('keeps stacked texts apart when they were not on screen together', () => {
    const title = read('SUMMER MENU', 0, 1, [0.2, 0.1, 0.6, 0.06], 300);
    const line = read('Mango lassi', 0, 1, [0.2, 0.17, 0.6, 0.06], 30);
    expect(words(cleanShotText([title, line], EVERY))).toEqual(['SUMMER MENU', 'Mango lassi']);
  });
});
