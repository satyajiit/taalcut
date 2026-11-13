// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P3-V15: every form of a reference to a place in a video, in English, Hindi, Spanish and Portuguese. */
import { describe, expect, it } from 'vitest';
import { RationalTime, TimeRange } from '@taalcut/core';
import { LAST, parseReferences, referenceBasis, TYPED_TIME_RATE, type ReferenceTarget } from '@taalcut/agent';

const targets = (message: string) => parseReferences(message).references.map((r) => r.target);
const one = (message: string): ReferenceTarget | undefined => targets(message)[0];
const slot = (index: number): ReferenceTarget => ({ kind: 'slot', index });
/** Typed times are exact in thousandths of a second (TYPED_TIME_RATE). */
const typed = (thousandths: number) => RationalTime.of(thousandths, TYPED_TIME_RATE);
const time = (thousandths: number): ReferenceTarget => ({ kind: 'time', at: typed(thousandths) });
const range = (start: number, end: number): ReferenceTarget => ({
  kind: 'range',
  range: TimeRange.fromStartEnd(typed(start), typed(end)),
});

describe('slot numbers', () => {
  it.each([
    ['make slot 3 shorter', 3],
    ['swap shot #3', 3],
    ['clip three is too dark', 3],
    ['cambia la toma 3', 3],
    ['troque o clipe 4', 4],
    ['स्लॉट 3 छोटा करो', 3],
    ['शॉट २ बदलो', 2],
    ['scene number 12 is weak', 12],
  ])('%s', (message, index) => expect(one(message)).toEqual(slot(index)));

  it('a number of seconds after a slot noun is a length, not a slot', () => {
    expect(targets('cut 3 seconds from the end')).toEqual([]);
  });
});

describe('ordinals and the hook', () => {
  it.each([
    ['the third shot is too dark', 3],
    ['the 2nd clip feels slow', 2],
    ['el tercer clip está oscuro', 3],
    ['la segunda toma', 2],
    ['o terceiro corte está lento', 3],
    ['a quarta cena', 4],
    ['तीसरा शॉट बहुत डार्क है', 3],
    ['दूसरी क्लिप हटा दो', 2],
    ['the hook needs more energy', 1],
    ['make the opening punchier', 1],
    ['el gancho es lento', 1],
    ['o gancho está fraco', 1],
    ['हुक को छोटा करो', 1],
    ['the last shot', LAST],
    ['el último clip', LAST],
    ['आखिरी शॉट', LAST],
  ])('%s', (message, index) => expect(one(message)).toEqual(slot(index)));
});

describe('times', () => {
  it.each([
    ['copy the transition at 0:04', 4000],
    ['what happens at 00:04.5?', 4500],
    ['at 1:02 the music drops', 62_000],
    ['the shot at 4s', 4000],
    ['the cut at 4 sec', 4000],
    ['at 4 seconds it gets blurry', 4000],
    ['at four seconds it gets blurry', 4000],
    ['a los 4 segundos', 4000],
    ['a los cuatro segundos', 4000],
    ['cambia el clip del segundo 8', 8000],
    ['aos 4 segundos', 4000],
    ['no segundo 6 tem um corte', 6000],
    ['4 सेकंड पर ट्रांज़िशन', 4000],
    ['०:०४ पर कट', 4000],
  ])('%s', (message, ms) => expect(one(message)).toEqual(time(ms)));

  it('a length is not a place', () => {
    expect(targets('make the hook 2 seconds shorter')).toEqual([slot(1)]);
    expect(targets('make it 4 seconds long')).toEqual([]);
  });

  it('reads clocks and spoken times as exact times', () => {
    expect(one('at 1:00:02')).toEqual(time(3_602_000));
    expect(one('at 0:04,25')).toEqual(time(4250));
    expect(one('at 3.5 s')).toEqual(time(3500));
    expect(one('at fifty seconds')).toEqual(time(50_000));
    expect(one('at 0:04.040')).toEqual(time(4040));
    expect(targets('soon')).toEqual([]);
  });
});

describe('ranges', () => {
  it.each([
    ['from 0:03 to 0:06', 3000, 6000],
    ['between 3 and 5 seconds', 3000, 5000],
    ['0:03-0:06 is too slow', 3000, 6000],
    ['de 0:03 a 0:06', 3000, 6000],
    ['entre 3 y 5 segundos', 3000, 5000],
    ['entre 3 e 5 segundos', 3000, 5000],
    ['0:03 से 0:06 तक', 3000, 6000],
    ['3 से 5 सेकंड', 3000, 5000],
  ])('%s', (message, start, end) => expect(one(message)).toEqual(range(start, end)));

  it('a backwards range is no range', () => {
    expect(targets('from 0:06 to 0:03')).toEqual([time(6000), time(3000)]);
  });
});

describe('several references, spans and cuts', () => {
  it('keeps the order, the words and where they are', () => {
    const message = 'Copy the transition at 0:04 into slot 2';
    const parsed = parseReferences(message);
    expect(parsed.references.map((r) => [r.said, r.target, r.cut])).toEqual([
      ['0:04', time(4000), true],
      ['slot 2', slot(2), false],
    ]);
    const first = parsed.references[0];
    expect(first && message.slice(first.span.start, first.span.end)).toBe('0:04');
  });

  it('marks cuts in every language', () => {
    for (const message of ['la transición a los 4 segundos', 'a transição aos 4 segundos', '०:०४ पर कट'])
      expect(parseReferences(message).references[0]?.cut, message).toBe(true);
    expect(parseReferences('the shot at 0:04').references[0]?.cut).toBe(false);
  });

  it('caps the references and has none in plain chat', () => {
    expect(parseReferences('slot 1 slot 2 slot 3 slot 4 slot 5 slot 6 slot 7').references).toHaveLength(5);
    expect(parseReferences('make me a vlog of my Goa trip')).toEqual({ references: [], basis: 'both' });
  });
});

describe('basis', () => {
  it.each([
    ['copy the transition at 0:04', 'template'],
    ['in the reference, what is at 0:04?', 'template'],
    ['use the same cut as the original at 0:04', 'template'],
    ['make slot 3 shorter', 'timeline'],
    ['in my video, the shot at 0:04 is blurry', 'timeline'],
    ['the third shot is too dark', 'timeline'],
    ['cambia el clip del segundo 8', 'timeline'],
    ['copia la transición de la referencia', 'template'],
    ['copy the transition at 0:04 to my video', 'both'],
    ['what is at 0:04?', 'both'],
  ] as const)('%s', (message, basis) => expect(referenceBasis(message)).toBe(basis));
});
