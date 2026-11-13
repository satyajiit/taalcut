// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { FAQ } from '#content/faq';
import { FEATURES } from '#content/features';
import * as HOME from '#content/home';
import { STARTER_FORMATS, STARTER_TOTAL } from '#content/home-starters';
import { REEL, rollWall, SLOT_PICKS } from '#components/home/reel-data';
import { filesUnder, read, REPO_ROOT } from './source-files';

/** Every string in the home's words, functions called with a typical argument. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') return [String((value as (...a: unknown[]) => unknown)(3, 'Weekend trip'))];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('the home’s words', () => {
  it('hold to the truth ledger and the hedge sweep', () => {
    const copy = strings([HOME, STARTER_FORMATS.map((s) => [s.name, s.kind, s.needs])]);
    expect(copy.length).toBeGreaterThan(80);
    expect(copy.flatMap(claimViolations)).toEqual([]);
  });

  it('say the ledger’s privacy line word for word', () => {
    expect(HOME.PRIVATE_SECTION.facts).toContain('Update checks still send the app’s version and a random ID.');
    expect(HOME.YOUR_AI_SECTION.local.on).toBe('Nothing of yours leaves your computer. Update checks still send the app’s version and a random ID.');
  });

  it('give the tour a line and a link for every feature of the reel pass, and keep each name to one line (24 characters)', () => {
    for (const f of FEATURES.filter((x) => x.group === 'reel')) {
      expect(HOME.TOUR.rows, f.slug).toHaveProperty(f.slug);
      expect(f.name.length, f.name).toBeLessThanOrEqual(24);
    }
  });

  it('tease questions the FAQ has', () => {
    for (const id of HOME.FAQ_TEASER.ids) expect(FAQ.map((f) => f.id)).toContain(id);
  });

  it('count the reel’s cuts as it has them', () => {
    const cuts = REEL.slots.length - 1;
    expect(HOME.TOUR.breakdown.found).toBe(`${cuts} cuts · ${REEL.beats.length} music beats`);
    expect(HOME.TOUR.agent.steps[0]).toContain(`${cuts} cuts, ${REEL.beats.length} music beats`);
  });
});

describe('the starter formats', () => {
  const catalogue = read('../packages/templates/src/starters/catalogue.ts');

  it('are the 8 an English window offers, of 14 in all', () => {
    expect(STARTER_FORMATS).toHaveLength(8);
    expect([...catalogue.matchAll(/\bid: '([a-z0-9-]+)'/g)]).toHaveLength(STARTER_TOTAL);
    for (const s of STARTER_FORMATS) expect(catalogue).toMatch(new RegExp(`id: '${s.id}'[^}]*locales: ('all'|\\['en'\\])`));
  });

  it('draw each starter’s real slots, from its shipped file', () => {
    for (const s of STARTER_FORMATS) {
      const file = JSON.parse(readFileSync(join(REPO_ROOT, 'packages/templates/starters', `${s.id}.json`), 'utf8')) as {
        structure: { duration: { value: number }; slots: { start: { value: number }; duration: { value: number }; role: string }[] };
      };
      const { structure } = file;
      expect(s.seconds, s.id).toBe(structure.duration.value / 30);
      expect(s.slots.map(([start, end, part]) => [start, end, part]), s.id).toEqual(
        structure.slots.map((slot) => {
          const start = Math.round((slot.start.value / 30) * 1000) / 1000;
          const end = Math.round(((slot.start.value + slot.duration.value) / 30) * 1000) / 1000;
          return [start, end, slot.role === 'body' ? 'build' : slot.role];
        }),
      );
    }
  });
});

describe('the demos’ data', () => {
  it('scatter one pick for each of the reel’s clips through a roll wall, the same wall every time', () => {
    const wall = rollWall(32);
    expect(wall).toHaveLength(32);
    const picks = wall.filter((c) => c.picked);
    expect(picks).toHaveLength(REEL.slots.length);
    expect(new Set(picks.map((p) => p.clipId)).size).toBe(REEL.slots.length);
    expect(rollWall(32)).toEqual(wall);
    // Dealt round the clips: no clip fills more than a few cells.
    const most = Math.max(...[...new Set(wall.map((c) => c.clipId))].map((id) => wall.filter((c) => c.clipId === id).length));
    expect(most).toBeLessThanOrEqual(4);
  });

  it('pick a clip for every slot', () => {
    expect(SLOT_PICKS).toHaveLength(REEL.slots.length);
    for (const s of SLOT_PICKS) expect(s.needs.length, `slot ${s.n}`).toBeGreaterThan(0);
  });
});

describe('the home’s source files', () => {
  it('carry the licence, a WEB2 stamp, and stay under 400 lines', () => {
    const files = [...filesUnder('src/components/home', ['.tsx', '.ts']), 'src/content/home.ts', 'src/content/home-starters.ts', 'src/app/page.tsx'];
    for (const file of files) {
      const text = read(file);
      expect(text.startsWith('// SPDX-License-Identifier: AGPL-3.0-or-later'), file).toBe(true);
      expect(text.split('\n').length, file).toBeLessThanOrEqual(400);
      if (file.endsWith('.tsx')) expect(text, file).toContain('system: WEB2 Remix Vernacular');
    }
  });

  it('import nothing from apps, packages or tools', () => {
    for (const file of [...filesUnder('src/components/home', ['.tsx', '.ts']), 'src/content/home.ts', 'src/content/home-starters.ts']) {
      expect(read(file), file).not.toMatch(/from '(\.\.\/)+(apps|packages|tools)\/|from '@taalcut\//);
    }
  });
});
