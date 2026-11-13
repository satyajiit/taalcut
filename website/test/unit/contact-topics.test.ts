// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { CONTACT_CHIPS } from '#content/contact';
import { claimViolations } from '#content/claims';
import { CONTACT_TOPICS } from '#lib/firebase/entries';
import { chipAfterKey, chipFromSearch, storedTopic } from '#components/contact/topics';
import { fieldProblem } from '#components/contact/use-contact-send';
import { INTRO_ATTRIBUTE, INTRO_SCRIPT, introShows } from '#components/contact/use-thread-intro';

describe('the contact thread’s topics', () => {
  it('are the five quick replies the brief names, in order', () => {
    expect(CONTACT_CHIPS.map((c) => c.label)).toEqual([
      'Say hello',
      'Press',
      'Privacy',
      'Security',
      'Something’s broken',
    ]);
  });

  it('store every chip under its own name, a topic the rules accept', () => {
    for (const chip of CONTACT_CHIPS) {
      const topic = storedTopic(chip.id);
      expect(CONTACT_TOPICS).toContain(topic);
      expect(topic).toBe(chip.id);
    }
    expect(CONTACT_TOPICS).toEqual(CONTACT_CHIPS.map((c) => c.id));
    expect(storedTopic(null)).toBe('hello');
  });

  it('read ?topic= from the address, and nothing else', () => {
    expect(chipFromSearch('?topic=privacy')).toBe('privacy');
    expect(chipFromSearch('?topic=Security')).toBe('security');
    expect(chipFromSearch('?topic=%20broken%20')).toBe('broken');
    expect(chipFromSearch('?topic=sales')).toBeNull();
    expect(chipFromSearch('')).toBeNull();
  });

  it('move by the radio group’s keys: arrows wrap, Home and End jump', () => {
    expect(chipAfterKey(null, 'ArrowRight')).toBe('hello');
    expect(chipAfterKey('hello', 'ArrowRight')).toBe('press');
    expect(chipAfterKey('broken', 'ArrowDown')).toBe('hello');
    expect(chipAfterKey('hello', 'ArrowLeft')).toBe('broken');
    expect(chipAfterKey('privacy', 'ArrowUp')).toBe('press');
    expect(chipAfterKey('privacy', 'Home')).toBe('hello');
    expect(chipAfterKey('privacy', 'End')).toBe('broken');
    expect(chipAfterKey('privacy', 'Enter')).toBeNull();
  });

  it('answer in words the truth ledger allows', () => {
    const words = CONTACT_CHIPS.flatMap((c) => [c.label, c.reply]);
    expect(words.flatMap(claimViolations)).toEqual([]);
  });
});

describe('the thread’s typed opening', () => {
  it('marks the page only when motion is allowed, and always lifts the mark on its own', () => {
    expect(INTRO_SCRIPT).toContain('prefers-reduced-motion: reduce');
    expect(INTRO_SCRIPT).toContain(`setAttribute('${INTRO_ATTRIBUTE}'`);
    expect(INTRO_SCRIPT).toMatch(
      /setTimeout\(function\(\)\{h\.removeAttribute\('data-contact-typing'\)\},4000\)/,
    );
  });

  it('shows the question sticker from step 1 and its answers, the chips, from step 2', () => {
    expect(introShows('done', 1)).toBe(true);
    expect(introShows('done', 2)).toBe(true);
    expect(introShows(0, 1)).toBe(false);
    expect(introShows(1, 1)).toBe(true);
    expect(introShows(1, 2)).toBe(false);
    expect(introShows(2, 2)).toBe(true);
  });
});

describe('the thread’s one-line replies', () => {
  const values = { name: '', email: '', message: '' };
  it('count as answered only when the answer is good, whatever the message holds', () => {
    expect(fieldProblem('name', values)).toBe('empty');
    expect(fieldProblem('name', { ...values, name: '   ' })).toBe('empty');
    expect(fieldProblem('name', { ...values, name: 'Asha' })).toBeNull();
    expect(fieldProblem('name', { ...values, name: 'A'.repeat(81) })).toBe('too-long');
    expect(fieldProblem('email', { ...values, email: 'asha' })).toBe('malformed');
    expect(fieldProblem('email', { ...values, email: 'asha@example.com' })).toBeNull();
  });
});
