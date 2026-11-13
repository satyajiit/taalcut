// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { CONTACT_CHIPS, CONTACT_PAGE } from '#content/contact';
import {
  causeRetries,
  causeWords,
  CONTACT_WORDS,
  emailHint,
  MAKE_LABELS,
  PLATFORM_CHOICES,
  WAITLIST_WORDS,
} from '#content/forms';
import { WAITLIST_PAGE } from '#content/waitlist';
import { EMAIL_MAX, EMAIL_PATTERN, emailProblem } from '#lib/email';
import { CONSENT_VERSION, CONTACT_LIMITS, CONTACT_TOPICS, PLATFORM_IDS } from '#lib/firebase/entries';
import type { WriteCause } from '#lib/firebase/outcome';
import { MAKES } from '#stores/waitlist';
import { storedTopic } from '#components/contact/topics';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

const CAUSES: WriteCause[] = ['refused', 'busy', 'timeout', 'unreachable', 'load-failed', 'unknown'];

describe('the forms’ words', () => {
  it('hold to the truth ledger', () => {
    const copy = strings([
      WAITLIST_WORDS,
      CONTACT_WORDS,
      PLATFORM_CHOICES,
      MAKE_LABELS,
      CONTACT_CHIPS,
      WAITLIST_PAGE,
      CONTACT_PAGE,
      CAUSES.flatMap((c) => [causeWords(c, 'The list'), causeWords(c, 'Our inbox')]),
      ['', 'a', 'a b@c.co', 'a@b@c.co', '@b.co', 'a/b@c.co', 'a@b'].map((raw) =>
        emailHint(raw, emailProblem(raw) ?? 'malformed'),
      ),
    ]);
    expect(copy.flatMap(claimViolations)).toEqual([]);
  });

  it('say Windows comes after 1.0, never that it works', () => {
    expect(PLATFORM_CHOICES.find((p) => p.id === 'windows')?.line).toBe('After 1.0');
  });

  it('name one fix for each address problem', () => {
    expect(emailHint('', 'empty')).toMatch(/name@example\.com/);
    expect(emailHint('asha', 'malformed')).toBe('Add the @, like name@example.com.');
    expect(emailHint('asha@', 'malformed')).toBe('Add the part after the @, like example.com.');
    expect(emailHint('asha @x.co', 'malformed')).toMatch(/space/);
    expect(emailHint('a@b@c.co', 'malformed')).toMatch(/one @/);
    expect(emailHint('x', 'too-long')).toMatch(/254/);
  });

  it('give every failure a cause and one fix, for both forms', () => {
    for (const cause of CAUSES) {
      for (const the of ['The list', 'Our inbox'] as const) {
        const line = causeWords(cause, the);
        // The fix is the line's Try again, or the words' second sentence: never both, never neither.
        const sentences = line.split('. ').length;
        expect(sentences, line).toBe(causeRetries(cause) ? 1 : 2);
      }
    }
  });

  it('offer every make and topic the rules accept, and store every chip under one of them', () => {
    expect(Object.keys(MAKE_LABELS).sort()).toEqual([...MAKES].sort());
    const stored = CONTACT_CHIPS.map((c) => storedTopic(c.id));
    for (const topic of stored) expect(CONTACT_TOPICS).toContain(topic);
    expect([...new Set(stored)].sort()).toEqual([...CONTACT_TOPICS].sort());
    expect(PLATFORM_CHOICES.map((p) => p.id)).toEqual(PLATFORM_IDS);
  });
});

describe('firestore.rules and the site agree', () => {
  const rules = readFileSync(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8');
  const list = (values: readonly string[]) => `[${values.map((v) => `'${v}'`).join(', ')}]`;

  it('on the consent version, the platforms, the makes and the topics', () => {
    expect(rules).toContain(`data.consentVersion == '${CONSENT_VERSION}'`);
    expect(rules).toContain(`hasOnly(${list(PLATFORM_IDS)})`);
    expect(rules).toContain(`data.make in ${list(MAKES)}`);
    expect(rules).toContain(`data.topic in ${list(CONTACT_TOPICS)}`);
  });

  it('on the address pattern and the lengths', () => {
    // The rules write the dot as [.] and escape backslashes for their own string literal.
    const rulesPattern = /value\.matches\('([^']+)'\)/
      .exec(rules)![1]!
      .replace(/\\\\/g, '\\')
      .replace('[.]', '\\.');
    expect(rulesPattern).toBe(EMAIL_PATTERN.source);
    expect(rules).toContain(`value.size() <= ${EMAIL_MAX}`);
    expect(rules).toContain(`data.name.size() <= ${CONTACT_LIMITS.name}`);
    expect(rules).toContain(`data.message.size() <= ${CONTACT_LIMITS.message}`);
  });
});
