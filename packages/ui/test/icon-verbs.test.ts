// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
// UX4 kit: one glyph per thing and per action (packages/ui/src/icons/concepts.ts). The verbs below carry their icon
// wherever they show; the app's <Button>s are read from source and a label may not lose its icon in more places
// than it does today. The ceilings only go down: a page lane that adds the icon lowers its number here.
import { resolve } from 'node:path';
import { isValidElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  ACTION_NAMES,
  CONCEPT_ICONS,
  ICON_SIZE,
  ICON_STROKE,
  MUST_CARRY,
  VERB_ICONS,
  type Verb,
} from '../src/icons/concepts';
import { inconsistent, scanButtons, scanSource } from './support/button-scan';

// Tests run from packages/ui (Vitest's root), whichever way they are started.
const ROOT = `${resolve(process.cwd(), '../..')}/`;
const SOURCES = [`${ROOT}apps/renderer/src`, `${ROOT}packages/ui/src`];

/**
 * The verbs that must carry their icon, with how many <Button>s still show each without it (2026-10-28, the UX4
 * audit's P2-14 list plus the scan's own finds). Lower a number when you add the icon; never raise one.
 */
const STILL_PLAIN: Readonly<Record<keyof typeof MUST_CARRY, number>> = {
  'make a video': 0,
  export: 0,
  'export again': 0,
  'export all': 0,
  import: 0,
  'add folder': 0,
  'clear filters': 0,
  'sign in': 0,
  'sign out': 0,
  'find similar': 0,
  'read this reel': 0,
  'try again': 0,
  'check again': 0,
  undo: 0,
  open: 0,
  'new chat': 0,
  'start a chat': 0,
  pause: 0,
  stop: 0,
};

/** Old names still in use, for the one-name rule: they may only disappear. */
const OLD_NAMES_LEFT: Readonly<Record<string, number>> = { 'add a folder': 0 };

describe('the icon registry', () => {
  it('has three sizes and one stroke', () => {
    expect(ICON_SIZE).toEqual({ sm: 14, md: 16, lg: 20 });
    expect(ICON_STROKE).toBe(2);
  });

  it('gives every concept and every verb a Lucide glyph', () => {
    for (const glyph of [...Object.values(CONCEPT_ICONS), ...Object.values(VERB_ICONS)]) {
      expect(glyph, 'a component, not an element').toBeTruthy();
      expect(isValidElement(glyph)).toBe(false);
      expect(typeof glyph === 'function' || typeof glyph === 'object').toBe(true);
    }
  });

  it('lists the verbs that must carry their icon, each with its glyph', () => {
    const verbs = Object.values(MUST_CARRY);
    for (const verb of verbs) expect(VERB_ICONS[verb as Verb]).toBeDefined();
    // The actions the audit found iconed in one place and not another lead the list.
    for (const label of ['make a video', 'export', 'clear filters', 'sign out', 'find similar', 'try again'])
      expect(MUST_CARRY[label]).toBeDefined();
  });
});

describe('the app keeps to it', () => {
  const buttons = scanButtons(SOURCES, ROOT);

  it('reads the app’s buttons', () => {
    expect(buttons.length).toBeGreaterThan(300);
  });

  for (const [label, ceiling] of Object.entries(STILL_PLAIN)) {
    it(`"${label}" loses its icon in no more places than before (${ceiling})`, () => {
      const plain = buttons.filter((button) => button.label === label && !button.iconed);
      expect(
        plain.length,
        `${label} without its icon:\n${plain.map((b) => `  ${b.file}:${b.line}`).join('\n')}`,
      ).toBeLessThanOrEqual(ceiling);
    });
  }

  it('retires old names, never adds them', () => {
    expect(Object.keys(OLD_NAMES_LEFT)).toEqual(Object.keys(ACTION_NAMES));
    for (const [old, left] of Object.entries(OLD_NAMES_LEFT))
      expect(buttons.filter((button) => button.label === old).length).toBeLessThanOrEqual(left);
  });

  it('shows each verb on the list the same way everywhere', () => {
    const mixed = inconsistent(buttons);
    expect(Object.keys(MUST_CARRY).filter((label) => mixed.has(label))).toEqual([]);
  });
});

describe('the scan', () => {
  it('counts an icon prop, a Lucide child and an aria-hidden glyph; skips words and links', () => {
    const source = `import { RotateCcw } from 'lucide-react';
      <Button onClick={() => a > b}>{t\`Try again\`}</Button>
      <Button icon={VERB_ICONS.retry}>{t\`Try again\`}</Button>
      <Button><RotateCcw aria-hidden />{t\`Try again\`}</Button>
      <Button asChild><Link to="/x"><Trans>Open</Trans></Link></Button>
      <Button size="icon" aria-label={t\`Undo\`} />`;
    const found = scanSource(source, 'x.tsx');
    expect(found.map((b) => [b.label, b.iconed])).toEqual([
      ['try again', false],
      ['try again', true],
      ['try again', true],
      ['open', false],
      ['undo', false],
    ]);
    expect(inconsistent(found).get('try again')).toEqual({ plain: 1, iconed: 2 });
  });
});
