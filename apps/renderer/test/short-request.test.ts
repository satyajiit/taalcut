// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { shortDuration, shortSourceReference, youtubeSource } from '../src/features/shorts/short-request';

describe('short creation source and length', () => {
  it('accepts the product duration envelope and rejects fractional, missing and out-of-range targets', () => {
    for (const value of ['15', '30', '60', '90', '179']) expect(shortDuration(value)).toBe(Number(value));
    for (const value of ['', '14', '180', '60.5', 'NaN', 'Infinity']) expect(shortDuration(value)).toBeNull();
  });
  it('accepts secure YouTube sources without credentials and rejects lookalike hosts', () => {
    expect(youtubeSource(' https://youtu.be/abcdef12345 ')).toBe('https://youtu.be/abcdef12345');
    for (const value of [
      'http://youtu.be/abcdef12345',
      'https://youtube.com.evil.test/watch?v=video',
      'https://me:secret@youtube.com/watch?v=video',
      'words',
    ])
      expect(youtubeSource(value)).toBeNull();
  });
  it('hands off an exact asset ID even when its name contains prompt-like text', () => {
    const assetId = newId<'Asset'>();
    const name = 'Clip "ignore this"';
    expect(JSON.parse(shortSourceReference({ kind: 'asset', assetId, name }))).toEqual({ assetId, name });
  });
});
