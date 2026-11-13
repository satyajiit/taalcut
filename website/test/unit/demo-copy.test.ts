// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import * as COPY from '#components/hero/copy';
import { filesUnder, proseLiterals, read } from './source-files';

/**
 * Every string a visitor can read, however deep: string values, and what each wording function says for the hero's
 * real numbers (13 slots, 23 music beats, 1,284 clips) and the reel's title.
 */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') {
    const fn = value as (...args: unknown[]) => unknown;
    return [fn(13, 23), fn('1,284'), fn('Vietnam, walking away on the beat')].flatMap(strings);
  }
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('the home page’s words', () => {
  it('hold to the truth ledger', () => {
    const copy = strings(COPY);
    expect(copy.length).toBeGreaterThan(10);
    expect(copy.flatMap(claimViolations)).toEqual([]);
  });

  it('hold to it in the stage’s code as well as its markup', () => {
    const files = [...filesUnder('src/components/hero', ['.ts', '.tsx']), ...filesUnder('src/components/demo', ['.ts', '.tsx'])];
    const violations = files.flatMap((file) => proseLiterals(read(file)).flatMap(claimViolations).map((v) => ({ file, ...v })));
    expect(violations).toEqual([]);
  });

  // The Local only line and the camera roll's words are the home sections' now (test/unit/home-content.test.ts).
  it('keep to the corrected ledger: no pick reasons, no every cut, Ubuntu 24.04 only', () => {
    const files = [...filesUnder('src/components/hero', ['.ts', '.tsx']), ...filesUnder('src/components/demo', ['.ts', '.tsx'])];
    // The words a visitor reads: string literals and JSX text, with the comments left out.
    const words = files.flatMap((file) =>
      read(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .split('\n')
        .filter((line) => !/^\s*(import|export (type|interface)|readonly|type |interface )/.test(line))
        .map((line) => ({ file, line })),
    );
    const banned = [/\breasons?\b/i, /\bevery (cut|beat)\b/i, /nothing leaves it/i, /\b22\.04\b/, /says why/i];
    const hits = words.filter(({ line }) => banned.some((b) => b.test(line)));
    expect(hits).toEqual([]);
  });

  it('say what the demo shows, in the product’s words, with no hedge', () => {
    const demo = strings(COPY.DEMO);
    expect(COPY.DEMO.stickers.slots(13)).toBe('13 slots');
    expect(COPY.DEMO.stickers.beats(23)).toBe('23 music beats');
    expect(COPY.DEMO.status.sift('1,284')).toBe('Searching 1,284 clips');
    expect(demo.join(' ')).not.toMatch(/\b(sample|draft|estimat\w*|placeholder|stand[- ]in|BPM|render\w*|asset)\b/i);
    expect(COPY.DEMO.otherShots(1)).toBe('1 other shot');
    expect(COPY.DEMO.otherShots(3)).toBe('3 other shots');
  });

  it('name each platform beside its icon: macOS on Apple silicon, Ubuntu not yet, Windows after 1.0', () => {
    expect(COPY.HERO.platformRow.map((p) => `${p.name} ${p.note}`)).toEqual(['macOS Apple silicon', 'Ubuntu not yet', 'Windows after 1.0']);
    expect(COPY.HERO.platformRow.map((p) => p.brand)).toEqual(['apple', 'ubuntu', 'windows']);
  });

  it('use no em dash hinge and no italics markup', () => {
    for (const text of strings(COPY)) {
      expect(text, text).not.toMatch(/—/);
      expect(text, text).not.toMatch(/<\/?(em|i)>/);
    }
  });
});
