// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  backoffDelay,
  canonicalJson,
  compareSemver,
  contentHash,
  parseSemver,
  satisfies,
  toCallName,
  toolInputHash,
} from '@taalcut/tools';
import { describe, expect, it } from 'vitest';

const v = (s: string) => parseSemver(s)!;

describe('semver', () => {
  it('parses versions and rejects others', () => {
    expect(parseSemver('1.2.3-beta.1+build.5')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['beta', '1'],
    });
    expect(parseSemver('01.2.3')).toBeUndefined();
    expect(parseSemver('1.2')).toBeUndefined();
  });

  it('orders versions, prereleases before releases', () => {
    const sorted = [
      '1.0.0',
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-beta',
      '1.0.0-alpha.beta',
      '0.9.9',
      '1.0.0-2',
      '1.0.0-10',
    ]
      .map(v)
      .sort(compareSemver)
      .map(
        (x) => `${x.major}.${x.minor}.${x.patch}${x.prerelease.length ? `-${x.prerelease.join('.')}` : ''}`,
      );
    expect(sorted).toEqual([
      '0.9.9',
      '1.0.0-2',
      '1.0.0-10',
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0',
    ]);
    expect(compareSemver(v('1.0.0-rc.1'), v('1.0.0-rc.1'))).toBe(0);
  });

  it.each([
    ['1.4.2', '*', true],
    ['1.4.2', '1', true],
    ['2.0.0', '1', false],
    ['1.4.2', '1.4', true],
    ['1.5.0', '1.4', false],
    ['1.4.2', '1.4.2', true],
    ['1.4.3', '1.4.2', false],
    ['1.9.0', '^1.4.2', true],
    ['1.4.1', '^1.4.2', false],
    ['2.0.0', '^1.4.2', false],
    ['0.3.9', '^0.3.1', true],
    ['0.4.0', '^0.3.1', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['1.4.9', '~1.4.2', true],
    ['1.5.0', '~1.4.2', false],
    ['nope', '*', false],
    ['1.0.0', '^nope', false],
  ])('%s satisfies %s: %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });
});

describe('hashing', () => {
  it('serialises with sorted keys, like JSON.stringify otherwise', () => {
    expect(canonicalJson({ b: 1, a: [3, undefined, () => 1], c: undefined, d: { y: null, x: 'é' } })).toBe(
      '{"a":[3,null,null],"b":1,"d":{"x":"é","y":null}}',
    );
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson(new Date(0))).toBe('"1970-01-01T00:00:00.000Z"');
    expect(canonicalJson(Number.NaN)).toBe('null');
  });

  it('hashes equal values equally whatever the key order', () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
    const tool = { name: 'media.probe', version: '1.0.0' };
    expect(toolInputHash(tool, { path: 'a' })).not.toBe(
      toolInputHash({ ...tool, version: '1.0.1' }, { path: 'a' }),
    );
  });

  it('makes provider-safe call names', () => {
    expect(toCallName('vision.describeFrame')).toBe('vision_describeFrame');
  });
});

describe('backoffDelay', () => {
  it('grows by the factor, caps at maxDelayMs and jitters between 50% and 100%', () => {
    const retry = { maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 300 };
    expect([1, 2, 3, 4].map((n) => backoffDelay(retry, n, () => 0.999999))).toEqual([100, 200, 300, 300]);
    expect(backoffDelay(retry, 1, () => 0)).toBe(50);
    expect(backoffDelay({ maxAttempts: 3, initialDelayMs: 10, factor: 3 }, 3, () => 0.999999)).toBe(90);
    expect(backoffDelay({ maxAttempts: 3, initialDelayMs: 40_000 }, 1, () => 0.999999)).toBe(30_000);
  });
});
