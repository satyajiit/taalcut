// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What people in a shot are doing, read leniently from a small model's answer (LIB1-FIND): fixed words through
 * inflections and synonyms, free -ing phrases kept, the sentence's own verbs counted, quoted text not, and motion
 * words dropped where the shot barely moves.
 */
import { SHOT_ACTION_LIMITS, shotActionSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  actionsInSentence,
  cleanAction,
  fixedAction,
  isStill,
  MOTION_ENERGY_FLOOR,
  shotActions,
} from '../../src/describe/actions';

describe('fixedAction', () => {
  it('reads inflections, base forms and synonyms as the fixed word', () => {
    expect(fixedAction('dance')).toBe('dancing');
    expect(fixedAction('Dances')).toBe('dancing');
    expect(fixedAction('danced')).toBe('dancing');
    expect(fixedAction('run')).toBe('running');
    expect(fixedAction('ran')).toBe('running');
    expect(fixedAction('swim')).toBe('swimming');
    expect(fixedAction('biking')).toBe('cycling');
    expect(fixedAction('playing the guitar')).toBe('playing music');
    expect(fixedAction('jogging')).toBe('running');
    expect(fixedAction('People dancing!')).toBe('dancing');
    expect(fixedAction('is talking')).toBe('talking');
  });

  it('has no fixed word for what is not an action', () => {
    expect(fixedAction('a temple')).toBeUndefined();
    expect(fixedAction('sunset')).toBeUndefined();
    expect(fixedAction('')).toBeUndefined();
  });
});

describe('cleanAction', () => {
  it('keeps letters, marks, digits, spaces, hyphens and apostrophes, lowercase, NFC', () => {
    expect(cleanAction('  Stir-Frying!! ')).toBe('stir-frying');
    expect(cleanAction('नाचना')).toBe('नाचना');
    expect(cleanAction('Café hopping')).toBe('café hopping');
  });
});

describe('actionsInSentence', () => {
  it('finds what someone in the sentence is doing', () => {
    expect(actionsInSentence('Two men dance on a stage while a crowd watches.')).toEqual(['dancing']);
    expect(actionsInSentence('A woman is cooking flatbread in a pan.')).toEqual(['cooking']);
    expect(actionsInSentence('People walking along a rainy street.')).toEqual(['walking']);
  });

  it('reads a word after no one as a thing, not an action', () => {
    expect(actionsInSentence('A painting hangs over a swimming pool.')).toEqual([]);
    expect(actionsInSentence('Drinks on a table by the window.')).toEqual([]);
  });

  it('ignores quoted text, as on a sign or a t-shirt', () => {
    expect(actionsInSentence('A sign reads "people dancing tonight" above a door.')).toEqual([]);
    expect(actionsInSentence("A banner says 'men running' over a road.")).toEqual([]);
  });
});

describe('shotActions', () => {
  it('puts fixed words first in vocabulary order, then free -ing phrases as answered', () => {
    const actions = shotActions({
      answer: ['juggling fire', 'Dance', 'clapping', 'a temple', 'juggling fire'],
      sentence: 'A performer on a stage.',
    });
    expect(actions).toEqual(['dancing', 'clapping', 'juggling fire']);
    for (const action of actions) expect(shotActionSchema.safeParse(action).success).toBe(true);
  });

  it('reads a comma-separated string, and the sentence when the list is missing', () => {
    expect(shotActions({ answer: 'talking, waving', sentence: 'A man talks.' })).toEqual([
      'talking',
      'waving',
    ]);
    expect(shotActions({ answer: undefined, sentence: 'Two girls dance in a courtyard.' })).toEqual([
      'dancing',
    ]);
    expect(shotActions({ answer: 42, sentence: 'A still lake.' })).toEqual([]);
  });

  it('drops motion words where nothing in the shot moves, and keeps the rest', () => {
    expect(shotActions({ answer: ['dancing', 'posing', 'talking'], sentence: '', still: true })).toEqual([
      'talking',
      'posing',
    ]);
    expect(shotActions({ answer: ['dancing'], sentence: '' })).toEqual(['dancing']);
  });

  it('calls footage still under the energy floor; a photo, or a shot not analysed, never', () => {
    const rate = { num: 30, den: 1 };
    const shot = (frames: number, energy: number | undefined) => ({
      range: { start: { value: 0, rate }, duration: { value: frames, rate } },
      analysis: energy === undefined ? null : ({ energy } as never),
    });
    expect(isStill(shot(90, MOTION_ENERGY_FLOOR / 2))).toBe(true);
    expect(isStill(shot(90, MOTION_ENERGY_FLOOR))).toBe(false);
    // One frame measures no movement.
    expect(isStill(shot(1, 0))).toBe(false);
    expect(isStill(shot(90, undefined))).toBe(false);
  });

  it('keeps at most the stored count, and no free phrase past the stored size', () => {
    const many = [
      'dancing',
      'singing',
      'clapping',
      'waving',
      'hugging',
      'posing',
      'talking',
      'laughing',
      'eating',
    ];
    expect(shotActions({ answer: many, sentence: '' })).toHaveLength(SHOT_ACTION_LIMITS.count);
    expect(shotActions({ answer: ['juggling '.repeat(8)], sentence: '' })).toEqual([]);
    expect(shotActions({ answer: ['juggling with five clubs today'], sentence: '' })).toEqual([]);
  });
});
