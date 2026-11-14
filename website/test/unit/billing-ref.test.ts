// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { beforeEach, describe, expect, it } from 'vitest';
import {
  entryRef,
  forgetEntryRef,
  refFor,
  rememberEntryRef,
  sanitizeRef,
  subscribeEntryRef,
  withRef,
} from '#lib/billing/ref';

/** The tag a link brought the visitor with: what is kept, what is sent, and what a link to /premium/ carries. */

describe('the tag a visit arrived with', () => {
  beforeEach(forgetEntryRef);

  it('is a short lowercase code, or nothing', () => {
    expect(sanitizeRef('producthunt')).toBe('producthunt');
    expect(sanitizeRef(' ProductHunt ')).toBe('producthunt');
    expect(sanitizeRef('launch_day-2')).toBe('launch_day-2');
    for (const raw of [null, undefined, '', '  ', 'product hunt', '<script>', 'a'.repeat(41), 'réf']) {
      expect(sanitizeRef(raw), String(raw)).toBeNull();
    }
  });

  it('is the page’s own, or the one the visit arrived with on another page', () => {
    expect(refFor('')).toBeNull();
    expect(refFor('?ref=producthunt')).toBe('producthunt');
    rememberEntryRef('?ref=producthunt&utm_source=ph');
    expect(refFor('')).toBe('producthunt');
    // The first tag of a visit stays; the page's own still wins.
    rememberEntryRef('?ref=other');
    expect(refFor('')).toBe('producthunt');
    expect(refFor('?ref=newsletter')).toBe('newsletter');
  });

  it('is nothing for a visit that arrived without one', () => {
    rememberEntryRef('?utm_source=x');
    expect(refFor('')).toBeNull();
    // A later page of the same visit can still bring one.
    rememberEntryRef('?ref=producthunt');
    expect(refFor('')).toBe('producthunt');
  });
});

describe('the tag in links to /premium/', () => {
  beforeEach(forgetEntryRef);

  it('is written into the address of /premium/ and of nothing else', () => {
    expect(withRef('/premium/', 'producthunt')).toBe('/premium/?ref=producthunt');
    expect(withRef('/premium/#order', 'producthunt')).toBe('/premium/?ref=producthunt#order');
    for (const href of [
      '/',
      '/download/',
      '/premium/thanks/',
      '/terms/#premium',
      '/faq/',
      'https://example.com/premium/',
      'mailto:a@b.co',
    ]) {
      expect(withRef(href, 'producthunt'), href).toBe(href);
    }
    expect(withRef('/premium/', null)).toBe('/premium/');
  });

  it('never carries anything but a plain code', () => {
    for (const tag of [
      '<script>',
      'a b',
      '"><img src=x>',
      'a&b=c',
      'a#b',
      '',
      'x'.repeat(41),
      'réf',
      '../x',
    ]) {
      expect(withRef('/premium/', tag), tag).toBe('/premium/');
    }
    expect(withRef('/premium/', 'Launch_Day-2')).toBe('/premium/?ref=launch_day-2');
    // What reaches an href always matches the pattern the billing service takes.
    expect(withRef('/premium/', 'producthunt').split('?ref=')[1]).toMatch(/^[a-z0-9_-]{1,40}$/);
  });

  it('tells its listeners once the visit’s tag is known, and only then', () => {
    let told = 0;
    const stop = subscribeEntryRef(() => {
      told += 1;
    });
    expect(entryRef()).toBeNull();
    rememberEntryRef('?utm_source=x');
    expect([entryRef(), told]).toEqual([null, 0]);
    rememberEntryRef('?ref=%3Cscript%3E');
    expect([entryRef(), told]).toEqual([null, 0]);
    rememberEntryRef('?ref=producthunt');
    expect([entryRef(), told]).toEqual(['producthunt', 1]);
    rememberEntryRef('?ref=other');
    expect([entryRef(), told]).toEqual(['producthunt', 1]);
    stop();
    forgetEntryRef();
    expect(told).toBe(1);
  });
});
