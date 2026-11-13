// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { browserAsksOff, resolveChoice } from '#lib/analytics/choice';
import { analyticsCookieNames, ANALYTICS_ON, clearAnalyticsCookies, cookieDomains, track } from '#lib/analytics/load';
import { ANALYTICS_HOSTS, buildCsp, FILM_HOSTS, FIREBASE_HOSTS } from '#lib/firebase/hosting-csp';

const directive = (policy: string, name: string) => policy.split('; ').find((d) => d.startsWith(`${name} `));

describe('the visitor’s analytics choice', () => {
  it('is on for a visitor who never chose, and off when the browser asks', () => {
    expect(resolveChoice(null, false)).toBe('on');
    expect(resolveChoice(null, true)).toBe('off');
  });

  it('keeps a choice the visitor made, over the browser’s signal', () => {
    expect(resolveChoice('off', false)).toBe('off');
    expect(resolveChoice('on', true)).toBe('on');
    expect(resolveChoice('maybe', false)).toBe('on');
  });

  it('reads Global Privacy Control and Do Not Track as asking off', () => {
    expect(browserAsksOff({ globalPrivacyControl: true })).toBe(true);
    expect(browserAsksOff({ doNotTrack: '1' })).toBe(true);
    expect(browserAsksOff({ globalPrivacyControl: false, doNotTrack: '0' })).toBe(false);
    expect(browserAsksOff({ doNotTrack: null })).toBe(false);
    expect(browserAsksOff(undefined)).toBe(false);
  });
});

describe('turning analytics off', () => {
  it('finds only the tag’s cookies', () => {
    expect(analyticsCookieNames('_ga=GA1.1.1; theme=x; _ga_PGM40PQ26X=GS2.1; _gal=1; a_ga=2')).toEqual([
      '_ga',
      '_ga_PGM40PQ26X',
    ]);
    expect(analyticsCookieNames('')).toEqual([]);
  });

  it('expires them on the host and every parent domain the tag could have used', () => {
    expect(cookieDomains('www.taalcut.app')).toEqual(['www.taalcut.app', 'taalcut.app']);
    expect(cookieDomains('taalcut.app')).toEqual(['taalcut.app']);
    expect(cookieDomains('localhost')).toEqual(['localhost']);
    const written: string[] = [];
    const doc = {
      get cookie() {
        return '_ga=1; _ga_X=2; keep=3';
      },
      set cookie(value: string) {
        written.push(value);
      },
    };
    clearAnalyticsCookies(doc, 'www.taalcut.app');
    expect(written).toEqual([
      '_ga=; Max-Age=0; path=/',
      '_ga=; Max-Age=0; path=/; domain=.www.taalcut.app',
      '_ga=; Max-Age=0; path=/; domain=.taalcut.app',
      '_ga_X=; Max-Age=0; path=/',
      '_ga_X=; Max-Age=0; path=/; domain=.www.taalcut.app',
      '_ga_X=; Max-Age=0; path=/; domain=.taalcut.app',
    ]);
  });
});

describe('a build without a measurement id', () => {
  it('counts nothing, and a tracked event is dropped', () => {
    expect(ANALYTICS_ON).toBe(false);
    expect(() => track('contact_sent', { topic: 'hello' })).not.toThrow();
  });
});

describe('the policy with analytics', () => {
  it('adds the tag’s hosts only when the build counts visits', () => {
    const off = buildCsp([], { firebase: true });
    const on = buildCsp([], { firebase: true, analytics: true });
    for (const host of [...ANALYTICS_HOSTS.connect, ...ANALYTICS_HOSTS.img]) expect(off).not.toContain(host);
    expect(directive(on, 'script-src')).toBe(
      `script-src 'self' ${FIREBASE_HOSTS.script.join(' ')} ${ANALYTICS_HOSTS.script.join(' ')}`,
    );
    expect(directive(on, 'connect-src')).toBe(
      `connect-src 'self' ${FIREBASE_HOSTS.connect.join(' ')} ${ANALYTICS_HOSTS.connect.join(' ')}`,
    );
    expect(directive(on, 'img-src')).toBe(`img-src 'self' data: ${ANALYTICS_HOSTS.img.join(' ')}`);
    expect(directive(on, 'frame-src')).toBe(`frame-src ${FIREBASE_HOSTS.frame.join(' ')} ${FILM_HOSTS.frame.join(' ')}`);
  });

  it('never lets a script from a wildcard host, or eval, in', () => {
    const on = buildCsp(["'sha256-x'"], { firebase: true, analytics: true });
    expect(directive(on, 'script-src')).not.toMatch(/\*|unsafe-eval|unsafe-inline|strict-dynamic/);
  });
});
