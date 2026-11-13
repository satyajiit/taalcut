// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  MAX_EMBEDDED_CHARS,
  pacingWords,
  plannedVectors,
  slotIntentText,
  templateDocumentText,
  textDigest,
} from '../../src/index';
import { intent, referenceTemplate } from '../helpers/fixtures';
import { nth } from './helpers';

describe('slotIntentText (the words casting embeds)', () => {
  const slot = nth(referenceTemplate().slots, 0);

  it('is the written sentence, trimmed', () => {
    expect(slotIntentText({ ...slot, intent: intent('  wide street at dusk  ') })).toBe(
      'wide street at dusk',
    );
  });

  it('falls back to the labels while the intent is pending or empty', () => {
    const pending = { ...intent('ignored', 'pending'), subject: 'bike', place: 'street' };
    expect(slotIntentText({ ...slot, intent: pending })).toBe('wide, static, bike, street');
  });

  it('is null when the slot says nothing', () => {
    const none = { ...intent('', 'pending'), shotType: null, motion: null };
    expect(slotIntentText({ ...slot, intent: none })).toBeNull();
  });
});

describe('templateDocumentText', () => {
  it('holds the name, tags, origin, pacing, every intent and the on-screen text', () => {
    const text = templateDocumentText(referenceTemplate(), { name: 'Goa trip', tags: ['travel', 'beach'] });
    expect(text).toContain('Goa trip');
    expect(text).toContain('Tags: travel, beach');
    expect(text).toContain('From an Instagram Reel');
    expect(text).toContain('1. hook: shot 1');
    expect(text).toContain('4. outro: shot 4');
    expect(text).toContain('On screen: Goa / Follow for more');
    expect(text).toContain('cut on the beat');
  });

  it('says the pacing in words', () => {
    const words = pacingWords(referenceTemplate());
    expect(words).toContain('4 shots over 4 seconds');
    expect(words).toContain('fast cuts, 1 s a shot');
    expect(words).toContain('120 BPM');
    expect(words).toContain('speed ramps');
    expect(words).toContain('dissolve transitions');
    expect(words).toContain('music sound');
  });

  it('is cut to the embedder contract', () => {
    const template = referenceTemplate();
    const long = {
      ...template,
      text: template.text.map((overlay) => ({ ...overlay, text: 'x'.repeat(500) })),
    };
    const many = { ...long, text: Array.from({ length: 30 }, () => nth(long.text, 0)) };
    expect(templateDocumentText(many, { name: 'n', tags: [] }).length).toBe(MAX_EMBEDDED_CHARS);
  });
});

describe('plannedVectors', () => {
  it('is one document vector and one query vector per slot with words, ids carrying their text', () => {
    const template = referenceTemplate();
    const planned = plannedVectors(template, { name: 'Goa trip', tags: [] });
    expect(planned.map((item) => [item.kind, item.purpose])).toEqual([
      ['template', 'document'],
      ['intent', 'query'],
      ['intent', 'query'],
      ['intent', 'query'],
      ['intent', 'query'],
    ]);
    const slot = nth(template.slots, 1);
    expect(nth(planned, 2).id).toBe(`intent:${template.id}:${slot.id}:${textDigest('shot 2')}`);
    expect(nth(planned, 0).id).toMatch(new RegExp(`^template:${template.id}:[0-9a-f]{16}$`));
  });

  it('leaves out a slot with no words', () => {
    const template = referenceTemplate();
    const silent = { ...intent('', 'pending'), shotType: null, motion: null };
    const slots = template.slots.map((slot, index) => (index === 2 ? { ...slot, intent: silent } : slot));
    expect(plannedVectors({ ...template, slots }, { name: 'n', tags: [] })).toHaveLength(4);
  });
});
