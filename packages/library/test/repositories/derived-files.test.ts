// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { unwrap, ValidationError, type DerivedFileRef } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { derivedVariant } from '../../src/index';
import { at24, fps24, profileSetup, range24 } from './profile-helpers';

const HASH = 'ab'.repeat(32);
const ref = (
  kind: DerivedFileRef['kind'],
  file: string,
  extra: Partial<DerivedFileRef> = {},
): DerivedFileRef => ({
  kind,
  key: `${kind === 'proxy' ? 'proxies' : `${kind}s`}/ab/${file}`,
  bytes: 1000,
  mimeType: kind === 'proxy' ? 'video/mp4' : 'image/jpeg',
  recipe: 1,
  ...extra,
});

describe('DerivedFileRepository (P2-L1)', () => {
  it('merges by kind and variant, finds by asset and shot, and evicts by key', () => {
    const { repos, asset } = profileSetup();
    const id = asset();
    const thumb = ref('thumbnail', `${HASH}.v1.jpg`, { width: 320, height: 568 });
    const proxy = ref('proxy', `${HASH}.v2.mp4`, { duration: at24(240), frameRate: fps24 });
    unwrap(repos.derivedFiles.put(id, [thumb, proxy]));
    expect(repos.derivedFiles.forAsset(id)).toEqual(
      [thumb, proxy].sort((a, b) => a.key.localeCompare(b.key)),
    );
    expect(repos.derivedFiles.find(id, 'proxy')).toEqual(proxy);

    // A new recipe of the thumbnail replaces the old one; another variant sits beside it.
    const newer = ref('thumbnail', `${HASH}.v2.jpg`);
    const square = ref('thumbnail', `${HASH}.square.v1.jpg`);
    unwrap(repos.derivedFiles.put(id, [newer, square]));
    expect(repos.derivedFiles.hasKey(thumb.key)).toBe(false);
    expect(
      repos.derivedFiles
        .forAsset(id)
        .map((r) => r.key)
        .sort(),
    ).toEqual([proxy.key, newer.key, square.key].sort());
    expect(derivedVariant(square.key)).toBe('square');
    expect(derivedVariant(newer.key)).toBe('');

    // A shot's own thumbnail doesn't replace the asset's.
    const [shotId] = unwrap(repos.shots.replaceForAsset(id, 0, [range24(0, 24)]));
    const shotThumb = ref('thumbnail', `${'cd'.repeat(32)}.s0.v1.jpg`);
    unwrap(repos.derivedFiles.put(id, [shotThumb], { shotId: shotId! }));
    expect(repos.derivedFiles.find(id, 'thumbnail', shotId!)).toEqual(shotThumb);
    expect(repos.derivedFiles.byKey(shotThumb.key)?.shotId).toBe(shotId);

    // media.derivedEvicted: rows go by key.
    expect(unwrap(repos.derivedFiles.removeKeys([proxy.key, 'proxies/ff/none.v1.mp4']))).toBe(1);
    expect(repos.derivedFiles.find(id, 'proxy')).toBeUndefined();
    expect(unwrap(repos.derivedFiles.removeKeys([]))).toBe(0);
  });

  it('refuses paths and bad refs, and goes with its asset', () => {
    const { repos, asset } = profileSetup();
    const id = asset();
    const path = repos.derivedFiles.put(id, [
      { ...ref('thumbnail', `${HASH}.v1.jpg`), key: '/Users/me/x.jpg' },
    ]);
    expect(!path.ok && ValidationError.is(path.error)).toBe(true);
    unwrap(
      repos.derivedFiles.put(id, [ref('waveform', `${HASH}.v1.json`, { mimeType: 'application/json' })]),
    );
    unwrap(repos.assets.remove(id));
    expect(repos.derivedFiles.forAsset(id)).toEqual([]);
  });
});
