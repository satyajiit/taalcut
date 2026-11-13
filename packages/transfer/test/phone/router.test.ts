// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
// @ts-expect-error phone modules ship as plain JavaScript for the browser.
import { beatStates, hashFor, parseHash, resolveRoute, STEPS, stepIndex } from '../../phone/router.mjs';

const unpaired = { paired: false, rows: 0, active: false };
const fresh = { paired: true, rows: 0, active: false };
const busy = { paired: true, rows: 3, active: true };
const finished = { paired: true, rows: 3, active: false };

describe('parseHash', () => {
  it('reads the four steps and nothing else', () => {
    expect(STEPS).toEqual(['pair', 'choose', 'sending', 'done']);
    for (const step of STEPS) {
      expect(parseHash(`#/${step}`)).toEqual({ route: step, token: null });
      expect(parseHash(`#/${step}/`).route).toBe(step);
    }
    for (const hash of ['', '#', '#/', '#/settings', '#/PAIR', '#pair', '#/pair/extra', '#/../done']) {
      expect(parseHash(hash).route, hash).toBeNull();
    }
  });

  it("takes the QR's pairing token from #k=… and no route with it", () => {
    expect(parseHash('#k=abc123_-')).toEqual({ route: null, token: 'abc123_-' });
    expect(parseHash('#k=')).toEqual({ route: null, token: null });
    expect(parseHash('#/pair').token).toBeNull();
  });

  it('writes a hash for each step, and the PIN step for anything else', () => {
    expect(hashFor('sending')).toBe('#/sending');
    expect(hashFor('nowhere')).toBe('#/pair');
  });
});

describe('resolveRoute', () => {
  it('keeps an unpaired phone on the PIN, wherever it asked to go', () => {
    for (const requested of [null, 'pair', 'choose', 'sending', 'done', 'nowhere']) {
      expect(resolveRoute(requested, unpaired), String(requested)).toBe('pair');
    }
  });

  it('puts the PIN behind a paired phone and sends an unknown route to the step that fits', () => {
    expect(resolveRoute('pair', fresh)).toBe('choose');
    expect(resolveRoute(null, fresh)).toBe('choose');
    expect(resolveRoute('pair', busy)).toBe('sending');
    expect(resolveRoute(null, busy)).toBe('sending');
    expect(resolveRoute('nowhere', finished)).toBe('choose');
  });

  it('opens sending only while something is on its way, and done only once something finished', () => {
    expect(resolveRoute('sending', fresh)).toBe('choose');
    expect(resolveRoute('sending', busy)).toBe('sending');
    expect(resolveRoute('sending', finished)).toBe('done');
    expect(resolveRoute('done', fresh)).toBe('choose');
    expect(resolveRoute('done', busy)).toBe('sending');
    expect(resolveRoute('done', finished)).toBe('done');
  });

  it('always lets a paired phone choose more', () => {
    for (const facts of [fresh, busy, finished]) expect(resolveRoute('choose', facts)).toBe('choose');
  });
});

describe('the beat rail', () => {
  it('marks passed steps done, this one current and the rest to do', () => {
    expect(beatStates('sending')).toEqual([
      ['pair', 'done'],
      ['choose', 'done'],
      ['sending', 'current'],
      ['done', 'todo'],
    ]);
    expect(beatStates('pair').map(([, state]: [string, string]) => state)).toEqual(['current', 'todo', 'todo', 'todo']);
    expect(stepIndex('done')).toBe(3);
    expect(stepIndex('nowhere')).toBe(0);
  });
});
