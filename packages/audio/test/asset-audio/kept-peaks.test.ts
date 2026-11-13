// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Kept waveform peaks: taken once, gone after the idle time, the oldest first over the byte cap (IX-D4). */
import { describe, expect, it } from 'vitest';
import { createKeptPeaks } from '../../src/asset-audio/kept-peaks';

describe('kept peaks', () => {
  it('hands each asset its peaks once', () => {
    const kept = createKeptPeaks(() => 0, { idleMs: 1000, maxBytes: 1024 });
    kept.keep('a', Buffer.from([1, 2]));
    expect(kept.take('a')).toEqual(Buffer.from([1, 2]));
    expect(kept.take('a')).toBeUndefined();
  });

  it('drops peaks nobody took within the idle time', () => {
    let now = 0;
    const kept = createKeptPeaks(() => now, { idleMs: 1000, maxBytes: 1024 });
    kept.keep('old', Buffer.alloc(4));
    now = 600;
    kept.keep('new', Buffer.alloc(4));
    now = 1200;
    kept.sweep();
    expect(kept.take('old')).toBeUndefined();
    expect(kept.take('new')).toBeDefined();
  });

  it('drops the oldest first once the kept peaks pass the byte cap', () => {
    const kept = createKeptPeaks(() => 0, { idleMs: 1000, maxBytes: 10 });
    kept.keep('a', Buffer.alloc(4));
    kept.keep('b', Buffer.alloc(4));
    kept.keep('c', Buffer.alloc(4));
    expect(kept.take('a')).toBeUndefined();
    expect(kept.take('b')).toBeDefined();
    expect(kept.take('c')).toBeDefined();
  });
});
