// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import {
  CONSENT_VERSION,
  contactEntry,
  contactProblems,
  normalizePlatforms,
  parsePlatform,
  resolveSource,
  sanitizeSource,
  SOURCE_PATTERN,
  waitlistEntry,
} from '#lib/firebase/entries';

describe('the source tag', () => {
  it('keeps a clean tag as it is', () => {
    expect(sanitizeSource('ig')).toBe('ig');
    expect(sanitizeSource('home-hero')).toBe('home-hero');
    expect(sanitizeSource('feature-auto-pick')).toBe('feature-auto-pick');
  });

  it('lowercases, joins words with single hyphens and trims the ends', () => {
    expect(sanitizeSource('IG Story!')).toBe('ig-story');
    expect(sanitizeSource('  --Reel__42--  ')).toBe('reel-42');
    expect(sanitizeSource('a/b?c=d')).toBe('a-b-c-d');
  });

  it('cuts to 40 characters without leaving a hyphen at the end', () => {
    const tag = sanitizeSource(`${'a'.repeat(39)} b`);
    expect(tag).toBe('a'.repeat(39));
    expect(sanitizeSource('x'.repeat(80))).toHaveLength(40);
  });

  it('gives null when nothing usable is left', () => {
    for (const raw of [null, undefined, '', '   ', '!!!', 'ॐ', '<script>'.replace(/[a-z]/g, '')]) {
      expect(sanitizeSource(raw), String(raw)).toBeNull();
    }
  });

  it('always matches the pattern the rules check', () => {
    for (const raw of ['IG', 'Tik Tok', 'ä-ö-ü', 'x'.repeat(100), '1', 'a--b']) {
      const tag = sanitizeSource(raw);
      if (tag !== null) expect(tag).toMatch(SOURCE_PATTERN);
    }
  });

  it('prefers the address’s ?ref=, then the form’s tag, then the default', () => {
    expect(resolveSource('?ref=ig', 'home-hero', 'site')).toBe('ig');
    expect(resolveSource('?ref=%20IG%20Bio', undefined, 'waitlist-page')).toBe('ig-bio');
    expect(resolveSource('?ref=!!!', 'home-hero', 'site')).toBe('home-hero');
    expect(resolveSource('', undefined, 'waitlist-page')).toBe('waitlist-page');
    expect(resolveSource('?platform=ubuntu', 'Band Close', 'site')).toBe('band-close');
  });
});

describe('platforms', () => {
  it('reads a platform from an address, in any case', () => {
    expect(parsePlatform('ubuntu')).toBe('ubuntu');
    expect(parsePlatform(' MacOS ')).toBe('macos');
    expect(parsePlatform('windows')).toBe('windows');
  });

  it('ignores anything the site does not list', () => {
    for (const raw of [null, undefined, '', 'linux', 'mac', 'macos ubuntu'])
      expect(parsePlatform(raw), String(raw)).toBeNull();
  });

  it('stores each known platform once, in the form’s order', () => {
    expect(normalizePlatforms(['windows', 'macos', 'macos', 'amiga'])).toEqual(['macos', 'windows']);
    expect(normalizePlatforms([])).toEqual([]);
  });
});

describe('the waitlist entry', () => {
  it('is keyed by the normalised email and carries the consent version', () => {
    expect(
      waitlistEntry({
        email: ' Asha@Example.COM ',
        platforms: ['ubuntu', 'macos'],
        make: 'food',
        source: 'ig',
      }),
    ).toEqual({
      email: 'asha@example.com',
      platforms: ['macos', 'ubuntu'],
      make: 'food',
      source: 'ig',
      consentVersion: CONSENT_VERSION,
    });
  });

  it('drops an unknown make and a bad source', () => {
    const entry = waitlistEntry({ email: 'a@b.co', platforms: [], make: 'cooking', source: '!!!' });
    expect(entry).toMatchObject({ make: null, source: 'site', platforms: [] });
  });

  it('refuses an address the rules would refuse', () => {
    for (const email of ['', 'asha@', 'asha@example', 'a b@c.co', `${'a'.repeat(250)}@x.co`]) {
      expect(waitlistEntry({ email, platforms: [], make: null, source: 'ig' }), email).toBeNull();
    }
  });
});

describe('the contact message', () => {
  const ok = { name: ' Asha ', email: 'Asha@Example.com', topic: 'press', message: ' Hello. ' };

  it('trims and normalises what it sends', () => {
    expect(contactEntry(ok)).toEqual({
      name: 'Asha',
      email: 'asha@example.com',
      topic: 'press',
      message: 'Hello.',
    });
  });

  it('falls back to hello for an unknown topic', () => {
    expect(contactEntry({ ...ok, topic: 'sales' })?.topic).toBe('hello');
  });

  it('names every field’s problem, in the form’s order', () => {
    expect(contactProblems({ name: ' ', email: 'x@', message: '' })).toEqual([
      ['name', 'empty'],
      ['email', 'malformed'],
      ['message', 'empty'],
    ]);
    expect(contactProblems({ name: 'x'.repeat(81), email: 'a@b.co', message: 'y'.repeat(2001) })).toEqual([
      ['name', 'too-long'],
      ['message', 'too-long'],
    ]);
    expect(contactEntry({ ...ok, message: '   ' })).toBeNull();
  });
});
