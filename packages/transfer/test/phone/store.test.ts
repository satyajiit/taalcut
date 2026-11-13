// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
// @ts-expect-error phone modules ship as plain JavaScript for the browser.
import { KEYS, parseToken, readJson, readText, writeJson, writeText } from '../../phone/store.mjs';
// @ts-expect-error phone modules ship as plain JavaScript for the browser.
import { pairErrorKey, setupCodeOf } from '../../phone/pairing.mjs';

function memoryHost() {
  const data = new Map<string, string>();
  return {
    data,
    sessionStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  };
}

const blocked = {
  get sessionStorage(): never {
    throw new Error('SecurityError');
  },
};

const refusing = {
  sessionStorage: {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => undefined,
  },
};

describe('what a reload keeps', () => {
  it('keeps text and JSON in this tab only, and removes a key for null', () => {
    const host = memoryHost();
    expect(writeText(host, KEYS.token, 'qr-token-1')).toBe(true);
    expect(readText(host, KEYS.token)).toBe('qr-token-1');
    expect(writeJson(host, KEYS.queue, [{ name: 'a.mov' }])).toBe(true);
    expect(readJson(host, KEYS.queue)).toEqual([{ name: 'a.mov' }]);
    expect(writeText(host, KEYS.token, null)).toBe(true);
    expect(host.data.has(KEYS.token)).toBe(false);
  });

  it('works on, empty-handed, when the browser blocks or refuses storage', () => {
    for (const host of [blocked, refusing]) {
      expect(readText(host, KEYS.session)).toBeNull();
      expect(readJson(host, KEYS.session)).toBeNull();
      expect(writeText(host, KEYS.session, 'x')).toBe(false);
    }
  });

  it('reads damaged JSON as nothing', () => {
    const host = memoryHost();
    host.data.set(KEYS.queue, '{not json');
    expect(readJson(host, KEYS.queue)).toBeNull();
  });

  it("keeps only a token that looks like the QR's", () => {
    expect(parseToken('AbC_123-xyzAbC_123-xy')).toBe('AbC_123-xyzAbC_123-xy');
    for (const value of [null, '', 'short', 'has space in it', 'a/b/c/d/e/f', 42]) expect(parseToken(value)).toBeNull();
  });
});

describe('pairing', () => {
  it('reads the setup code as the Mac checks it, however 7KD2 M9QX was typed', () => {
    for (const typed of ['7KD2 M9QX', '7kd2m9qx', ' 7KD2-M9QX ', '7kd2\tm9qx']) expect(setupCodeOf(typed), typed).toBe('7KD2M9QX');
    expect(setupCodeOf('O1IL 2345')).toBe('01112345');
    expect(setupCodeOf(null)).toBe('');
  });

  it('has its own sentence for each way pairing fails', () => {
    expect(pairErrorKey(401)).toBe('pair.error.rejected');
    expect(pairErrorKey(429)).toBe('pair.error.rate');
    expect(pairErrorKey(403)).toBe('pair.error.full');
    expect(pairErrorKey(404)).toBe('pair.error.closed');
    expect(pairErrorKey(0)).toBe('pair.error.network');
    expect(pairErrorKey(500)).toBe('pair.error.network');
  });
});
