// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
// @ts-expect-error phone modules ship as plain JavaScript for the browser.
import { CHUNK_SIZE, RETRY_DELAYS, retryDelayMs, shouldRetry } from '../../phone/logic.mjs';

describe('shouldRetry', () => {
  it('retries network errors, 423, 429, and 5xx other than 507', () => {
    expect(shouldRetry({ status: 401, isNetworkError: true })).toBe(true);
    for (const status of [423, 429, 500, 502, 503, 599]) {
      expect(shouldRetry({ status, isNetworkError: false })).toBe(true);
    }
    for (const status of [401, 403, 413, 415, 507, 400, 404, 408, 409]) {
      expect(shouldRetry({ status, isNetworkError: false })).toBe(false);
    }
  });
});

describe('retryDelayMs', () => {
  it('walks the delay list and then waits 30 seconds', () => {
    expect(RETRY_DELAYS).toEqual([0, 1000, 3000, 5000, 10000, 20000, 30000]);
    expect(CHUNK_SIZE).toBe(32 * 1024 * 1024);
    expect(retryDelayMs(0)).toBe(0);
    expect(retryDelayMs(1)).toBe(1000);
    expect(retryDelayMs(2)).toBe(3000);
    expect(retryDelayMs(3)).toBe(5000);
    expect(retryDelayMs(4)).toBe(10000);
    expect(retryDelayMs(5)).toBe(20000);
    expect(retryDelayMs(6)).toBe(30000);
    expect(retryDelayMs(7)).toBe(30000);
    expect(retryDelayMs(100)).toBe(30000);
  });

  it('honours a Retry-After delay in seconds and ignores an HTTP date', () => {
    expect(retryDelayMs(1, '2')).toBe(2000);
    expect(retryDelayMs(1, ' 15 ')).toBe(15000);
    expect(retryDelayMs(1, '0')).toBe(0);
    expect(retryDelayMs(1, '12')).toBe(12000);
    expect(retryDelayMs(1, 5)).toBe(5000);
    expect(retryDelayMs(1, '1.5')).toBe(1500);
    expect(retryDelayMs(1, 'Wed, 21 Oct 2015 07:28:00 GMT')).toBe(1000);
    expect(retryDelayMs(4, 'Wed, 21 Oct 2015 07:28:00 GMT')).toBe(10000);
  });
});
