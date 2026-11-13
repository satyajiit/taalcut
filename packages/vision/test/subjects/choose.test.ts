// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: a sample's one subject without the helper, as the helper chooses it: a face with its person is their
 * union, a face alone is a face, a person alone a human; the candidate overlapping the previous subject wins, else the
 * most confident.
 */
import { describe, expect, it } from 'vitest';
import { chooseSubject } from '../../src/subjects/choose';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe('chooseSubject', () => {
  it('pairs a face with the person it is in, and keeps a lone person as a human', () => {
    const face = { box: box(0.42, 0.2, 0.06, 0.1), confidence: 0.9 };
    const person = { box: box(0.35, 0.15, 0.2, 0.8), confidence: 0.7 };
    const chosen = chooseSubject([face], [person], null);
    expect(chosen.kind).toBe('union');
    expect(chosen.box).toEqual(person.box);
    expect(chosen.focus!.x).toBeCloseTo(0.45, 9);
    expect(chooseSubject([], [person], null)).toMatchObject({
      kind: 'human',
      box: person.box,
      confidence: 0.7,
    });
    expect(chooseSubject([face], [], null)).toMatchObject({ kind: 'face', box: face.box });
    expect(chooseSubject([], [], null)).toEqual({ kind: 'none', box: null, focus: null, confidence: 0 });
  });

  it('follows the previous subject before the most confident one', () => {
    const left = { box: box(0.05, 0.1, 0.2, 0.8), confidence: 0.6 };
    const right = { box: box(0.7, 0.1, 0.2, 0.8), confidence: 0.9 };
    expect(chooseSubject([], [left, right], null).box).toEqual(right.box);
    expect(chooseSubject([], [left, right], box(0.04, 0.1, 0.2, 0.8)).box).toEqual(left.box);
  });
});
