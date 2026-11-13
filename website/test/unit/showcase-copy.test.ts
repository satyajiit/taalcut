// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { FEATURE_STEPS, FEATURE_STICKERS, FEATURES, FEATURES_INDEX, nextFeature } from '#content/features';
import {
  ATTACHMENT,
  CHANGES,
  CHECKS,
  INTRO_WORDS,
  OUTRO_WORDS,
  STEPS,
  USER_WORDS,
} from '#components/showcase/agent/run-script';
import { SAMPLE_ROLL } from '#components/showcase/auto-pick/roll';
import { DOUBT_WORDS, sampleBreakdown } from '#components/showcase/breakdown/sample';
import { CAPTIONS, CLIPS, TITLE } from '#components/showcase/editor/cut';
import { SHOWCASE_HINTS } from '#components/showcase/hints';
import { ROLLS, SHOT_NEEDS } from '#components/showcase/templates/template';
import { FORMATS, STARTERS, startersInOneLanguage } from '#components/showcase/templates/starters';
import { filesUnder, read } from './source-files';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('the showcases’ words', () => {
  it('hold to the truth ledger, sample data included', () => {
    const breakdown = sampleBreakdown();
    const copy = strings([
      FEATURE_STEPS,
      DOUBT_WORDS,
      breakdown.shots,
      breakdown.texts,
      SAMPLE_ROLL.map((c) => [c.name, c.tags]),
      ROLLS,
      SHOT_NEEDS,
      STARTERS,
      FORMATS,
      [USER_WORDS, ATTACHMENT, INTRO_WORDS, OUTRO_WORDS],
      STEPS,
      CHECKS,
      CHANGES,
      CLIPS,
      CAPTIONS,
      TITLE.text,
      FEATURE_STICKERS,
      FEATURES_INDEX,
      Object.values(SHOWCASE_HINTS).map((h) => h.title),
    ]);
    expect(copy.length).toBeGreaterThan(100);
    expect(copy.flatMap(claimViolations)).toEqual([]);
  });

  it('give every feature three header stickers of a few words each', () => {
    for (const f of FEATURES) {
      const stickers = FEATURE_STICKERS[f.slug] ?? [];
      expect(stickers, f.slug).toHaveLength(3);
      for (const words of stickers) expect(words.length, words).toBeLessThanOrEqual(32);
    }
  });

  it('give every feature two or three steps, and lead each page to the next', () => {
    for (const f of FEATURES) {
      const steps = FEATURE_STEPS[f.slug] ?? [];
      expect(steps.length, f.slug).toBeGreaterThanOrEqual(2);
      expect(steps.length, f.slug).toBeLessThanOrEqual(3);
    }
    expect(FEATURES.map((f) => nextFeature(f.slug).slug)).toEqual(
      [...FEATURES.slice(1), FEATURES[0]].map((f) => f?.slug),
    );
  });

  it('list the starters the app ships, 8 in each language and 14 in all, as the facts say', () => {
    expect(STARTERS).toHaveLength(14);
    expect(FORMATS).toHaveLength(8);
    expect(new Set(STARTERS.map((s) => s.format)).size).toBe(8);
    expect(startersInOneLanguage()).toBe(8);
    expect(
      FEATURES.find((f) => f.slug === 'templates')?.facts.some(([, v]) =>
        v.includes('8 starter templates in your language, 14 in all'),
      ),
    ).toBe(true);
  });

  it('keep every feature’s name to one short line, for the home index’s links', () => {
    for (const f of FEATURES) expect(f.name.length, f.name).toBeLessThanOrEqual(24);
  });

  it('say only what the corrected ledger says: no reasons per pick, no VTT, no per-chat thinking, no “every cut”', () => {
    const source = [
      ...filesUnder('src/components/showcase', ['.ts', '.tsx']),
      'src/content/features.ts',
      'src/app/features/[slug]/page.tsx',
    ]
      .map(read)
      .join('\n');
    const words = strings([FEATURES, FEATURE_STEPS, STEPS, CHANGES, CLIPS]).join('\n');
    for (const text of [source, words]) {
      expect(text).not.toMatch(/\bVTT\b/);
      expect(text).not.toMatch(/per chat/i);
      expect(text).not.toMatch(/every (cut|beat) and/i);
      expect(text).not.toMatch(/Thinking: Balanced/);
    }
    expect(words).not.toMatch(/\breason/i);
    expect(words).not.toMatch(/alternates/i);
    expect(source).not.toMatch(/Shift.{0,40}trim|trim.{0,40}Shift/i);
  });

  it('never call the phone transfer encrypted', () => {
    const source = filesUnder('src/components/showcase', ['.ts', '.tsx']).map(read).join('\n');
    expect(source).not.toMatch(/encrypt/i);
  });

  it('mark every source file with the licence and keep it under 400 lines', () => {
    for (const file of [
      ...filesUnder('src/components/showcase', ['.ts', '.tsx']),
      ...filesUnder('src/app/features', ['.tsx']),
    ]) {
      const text = read(file);
      expect(
        text.startsWith(
          '// SPDX-License-Identifier: AGPL-3.0-or-later\n// Copyright (C) 2026 Taalcut contributors',
        ),
        file,
      ).toBe(true);
      expect(text.split('\n').length, file).toBeLessThanOrEqual(400);
    }
  });
});
