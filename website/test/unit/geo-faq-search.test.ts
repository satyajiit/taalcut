// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { matchFaq, splitMatches, terms } from '#components/content/faq-search';
import { FAQ } from '#content/faq';

/** The FAQ's search-as-you-type (components/content/faq-search.ts): what matches, and what gets marked. */

describe('terms', () => {
  it('folds case and apostrophes, trims punctuation and drops repeats', () => {
    expect(terms('  Can’t  CAN\'T phone? ')).toEqual(["can't", 'phone']);
    expect(terms('')).toEqual([]);
    expect(terms('   ')).toEqual([]);
  });
});

describe('matchFaq', () => {
  const entry = { question: 'How do I get clips off my phone?', answer: 'Scan a QR code with your phone and enter the PIN.' };

  it('matches every question for an empty query, opening none', () => {
    for (const e of FAQ) expect(matchFaq(e, [])).toEqual({ any: true, inAnswer: false });
  });

  it('needs every word somewhere in the question or the answer', () => {
    expect(matchFaq(entry, ['phone', 'pin']).any).toBe(true);
    expect(matchFaq(entry, ['phone', 'windows']).any).toBe(false);
  });

  it('opens the answer when a word is in it', () => {
    expect(matchFaq(entry, ['qr']).inAnswer).toBe(true);
    expect(matchFaq(entry, ['clips']).inAnswer).toBe(false);
  });

  it('finds the questions a visitor would look for', () => {
    const hits = (q: string) => FAQ.filter((e) => matchFaq(e, terms(q)).any).map((e) => e.id);
    expect(hits('chatgpt')).toContain('chatgpt');
    expect(hits('ollama')).toContain('own-server');
    expect(hits('local only')).toContain('local-only');
    expect(hits('zzzz')).toEqual([]);
  });
});

describe('splitMatches', () => {
  it('marks each match in place and keeps the text whole', () => {
    const parts = splitMatches('Your Phone, your phone.', ['phone']);
    expect(parts.map((p) => p.text).join('')).toBe('Your Phone, your phone.');
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['Phone', 'phone']);
  });

  it('matches a straight apostrophe against a curly one, and escapes the query', () => {
    expect(splitMatches('Can I use a reel’s template?', ["reel's"]).some((p) => p.match && p.text === 'reel’s')).toBe(true);
    expect(splitMatches('a (b) c', ['(b)'])).toEqual([
      { text: 'a ', match: false },
      { text: '(b)', match: true },
      { text: ' c', match: false },
    ]);
  });
});
