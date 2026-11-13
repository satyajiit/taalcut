// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { PLATFORM_GETS, PLATFORMS, PLATFORMS_PAGE } from '#content/platforms';
import { DEFAULT_ORDER, detectPlatform, orderFor } from '#components/platforms/detect';

const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  ubuntu: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

describe('the visitor’s platform', () => {
  it('comes from client hints first', () => {
    expect(detectPlatform({ uaPlatform: 'macOS', userAgent: UA.windows })).toBe('macos');
    expect(detectPlatform({ uaPlatform: 'Windows', userAgent: UA.mac })).toBe('windows');
    expect(detectPlatform({ uaPlatform: 'Linux', userAgent: UA.mac })).toBe('ubuntu');
    expect(detectPlatform({ uaPlatform: 'Android', userAgent: UA.android })).toBeNull();
    expect(detectPlatform({ uaPlatform: 'Chrome OS', userAgent: UA.mac })).toBeNull();
  });

  it('then from the user agent', () => {
    expect(detectPlatform({ userAgent: UA.mac })).toBe('macos');
    expect(detectPlatform({ userAgent: UA.windows })).toBe('windows');
    expect(detectPlatform({ userAgent: UA.ubuntu })).toBe('ubuntu');
    expect(detectPlatform({ uaPlatform: '', userAgent: UA.ubuntu })).toBe('ubuntu');
  });

  it('is nobody’s computer on a phone or a tablet, an iPad asking for the desktop site included', () => {
    expect(detectPlatform({ userAgent: UA.iphone })).toBeNull();
    expect(detectPlatform({ userAgent: UA.android })).toBeNull();
    expect(detectPlatform({ userAgent: UA.mac, touchPoints: 5 })).toBeNull();
  });

  it('puts theirs first and keeps the others in the default order', () => {
    expect(orderFor(null)).toEqual(['macos', 'ubuntu', 'windows']);
    expect(orderFor('ubuntu')).toEqual(['ubuntu', 'macos', 'windows']);
    expect(orderFor('windows')).toEqual(['windows', 'macos', 'ubuntu']);
    expect(DEFAULT_ORDER).toEqual(PLATFORMS.map((p) => p.id));
  });
});

describe('the platforms page’s words', () => {
  it('hold to the truth ledger, and give every platform its stickers, its join and what it will get', () => {
    const words = Object.values(PLATFORMS_PAGE.platforms).flatMap((p) => [
      p.heading,
      p.join,
      p.yours,
      p.window,
      ...p.stickers.map((s) => s.words),
    ]);
    expect([...words, PLATFORMS_PAGE.lead, ...PLATFORMS_PAGE.title].flatMap(claimViolations)).toEqual([]);
    for (const p of PLATFORMS) expect(PLATFORM_GETS[p.id]).toMatch(/^You get /);
    expect(PLATFORMS_PAGE.platforms.windows.after).toBe('After 1.0');
    expect(PLATFORMS_PAGE.platforms.ubuntu.heading).toBe('Ubuntu 24.04');
  });
});
