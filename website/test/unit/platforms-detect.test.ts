// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { PLATFORM_GETS, PLATFORMS, PLATFORMS_PAGE } from '#content/platforms';
import { RELEASE } from '#content/release';
import { detectPlatform } from '#components/platforms/detect';

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
});

describe('the download page’s words', () => {
  it('hold to the truth ledger, and give every platform its stickers and what it has today', () => {
    const words = Object.values(PLATFORMS_PAGE.platforms).flatMap((p) => [
      p.heading,
      p.yours,
      p.window,
      ...p.stickers.map((s) => s.words),
    ]);
    const page = [
      ...words,
      PLATFORMS_PAGE.lead,
      ...PLATFORMS_PAGE.title,
      PLATFORMS_PAGE.notes,
      PLATFORMS_PAGE.source,
      ...Object.values(PLATFORM_GETS),
    ];
    expect(page.flatMap(claimViolations)).toEqual([]);
    expect(PLATFORMS_PAGE.platforms.windows.after).toBe('After 1.0');
    expect(PLATFORMS_PAGE.platforms.ubuntu.after).toBe('No download yet');
    expect(PLATFORMS_PAGE.platforms.ubuntu.heading).toBe('Ubuntu 24.04');
  });

  it('give the Mac alone a download, and promise the others no date', () => {
    expect(PLATFORMS.map((p) => [p.id, p.status])).toEqual([
      ['macos', 'released'],
      ['ubuntu', 'not-yet'],
      ['windows', 'not-yet'],
    ]);
    expect(PLATFORM_GETS.macos).toBe(
      `You get ${RELEASE.name} as a .dmg, signed with a Developer ID and notarized by Apple.`,
    );
    expect(PLATFORM_GETS.ubuntu).toBe('No Ubuntu download yet, and no date for one.');
    expect(PLATFORM_GETS.windows).toBe('No Windows download yet.');
    // No package is named for a platform without one.
    expect(
      JSON.stringify([
        PLATFORMS.filter((p) => p.status === 'not-yet'),
        PLATFORMS_PAGE.platforms.ubuntu,
        PLATFORMS_PAGE.platforms.windows,
      ]),
    ).not.toMatch(/\.deb|\.exe|\.msi/);
  });
});
