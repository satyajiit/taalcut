// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX1-IMPORT: a phone is named by what its browser says. Chrome's reduced User-Agent sends "K" in place of the
// model, which named every Chrome phone (and so its import source) "K"; Firefox sends "Mobile" or "Tablet".
import { describe, expect, it } from 'vitest';
import { describeDevice } from '../../src/pairing/secrets';

const reduced = (mobile: boolean) =>
  `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 ${mobile ? 'Mobile ' : ''}Safari/537.36`;

const firefox = (form: 'Mobile' | 'Tablet') =>
  `Mozilla/5.0 (Android 14; ${form}; rv:131.0) Gecko/131.0 Firefox/131.0`;

describe('the device a phone is named by', () => {
  it('names a Chrome phone or tablet by what it is, not by the placeholder model', () => {
    expect(describeDevice(reduced(true))).toEqual({ label: 'Android phone', platform: 'android' });
    expect(describeDevice(reduced(false))).toEqual({ label: 'Android tablet', platform: 'android' });
  });

  it('keeps a real model when the browser sends one', () => {
    const samsung =
      'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
    expect(describeDevice(samsung)).toEqual({ label: 'SM-S921B', platform: 'android' });
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36')).toEqual({
      label: 'Pixel 8',
      platform: 'android',
    });
  });

  it('names a Firefox phone or tablet by what it is: Firefox sends no model', () => {
    expect(describeDevice(firefox('Mobile'))).toEqual({ label: 'Android phone', platform: 'android' });
    expect(describeDevice(firefox('Tablet'))).toEqual({ label: 'Android tablet', platform: 'android' });
  });

  it('names iPhones and iPads as before', () => {
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
    expect(describeDevice(iphone)).toEqual({ label: 'iPhone', platform: 'ios' });
  });
});
