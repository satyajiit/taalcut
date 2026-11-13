// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { captionUnits, unitBatches } from '../../src/translate/units';
import { cueOf, type CueSpec } from './captions';

const texts = (specs: readonly CueSpec[]) => captionUnits(specs.map(cueOf)).map((unit) => unit.text);

describe('captionUnits', () => {
  it('ends a unit at end punctuation, Devanagari dandas and closing quotes included', () => {
    expect(
      texts([
        { text: 'Is it ready?', startMs: 0, endMs: 900 },
        { text: 'Yes,', startMs: 900, endMs: 1200 },
        { text: 'it is.', startMs: 1200, endMs: 1700 },
        { text: 'यह तैयार है।', startMs: 1700, endMs: 2600 },
        { text: 'He said "go!"', startMs: 2600, endMs: 3400 },
        { text: 'और फिर॥', startMs: 3400, endMs: 4000 },
      ]),
    ).toEqual(['Is it ready?', 'Yes, it is.', 'यह तैयार है।', 'He said "go!"', 'और फिर॥']);
  });

  it('ends a unit before a pause of 600 ms or more, not a shorter one', () => {
    expect(
      texts([
        { text: 'and then', startMs: 0, endMs: 600 },
        { text: 'we went', startMs: 1150, endMs: 1800 },
        { text: 'home', startMs: 2400, endMs: 2900 },
      ]),
    ).toEqual(['and then we went', 'home']);
  });

  it('holds at most three cues', () => {
    const cues = Array.from({ length: 7 }, (_, i) => ({
      text: `word${i}`,
      startMs: i * 400,
      endMs: i * 400 + 400,
    }));
    expect(captionUnits(cues.map(cueOf)).map((unit) => unit.cues.length)).toEqual([3, 3, 1]);
  });

  it('reads cues in timeline order and numbers units u0, u1, …', () => {
    const later = cueOf({ text: 'Second.', startMs: 2000, endMs: 2500 });
    const earlier = cueOf({ text: 'First.', startMs: 0, endMs: 500 });
    const units = captionUnits([later, earlier]);
    expect(units.map((unit) => [unit.id, unit.text])).toEqual([
      ['u0', 'First.'],
      ['u1', 'Second.'],
    ]);
  });
});

describe('unitBatches', () => {
  it('splits into batches with the previous batch’s last two units as context', () => {
    const units = Array.from({ length: 205 }, (_, i) => ({ id: `u${i}`, text: `Line ${i}.` }));
    const batches = unitBatches(units);
    expect(batches.map((batch) => batch.units.length)).toEqual([100, 100, 5]);
    expect(batches.map((batch) => batch.context.map((unit) => unit.id))).toEqual([
      [],
      ['u98', 'u99'],
      ['u198', 'u199'],
    ]);
  });

  it('honours a smaller batch size', () => {
    const units = Array.from({ length: 3 }, (_, i) => ({ id: `u${i}`, text: `${i}` }));
    expect(unitBatches(units, 1).map((batch) => batch.context.length)).toEqual([0, 1, 2]);
  });
});
