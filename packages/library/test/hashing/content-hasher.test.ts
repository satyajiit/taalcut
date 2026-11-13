// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The content hasher (ADR 0001): the ADR's known answers, the partial hash's
 * exact sampled layout (checked against an independent computation), and
 * streaming, cancellation and missing files as values.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createXXHash128 } from 'hash-wasm';
import { describe, expect, it } from 'vitest';
import {
  createWasmContentHasher,
  hashBytes,
  PARTIAL_SAMPLE_THRESHOLD,
  PARTIAL_WINDOW_BYTES,
  partialWindows,
  sizePrefix,
} from '../../src/index';
import { tempDir } from '../helpers';

const hasher = createWasmContentHasher();

async function referencePartial(bytes: Uint8Array): Promise<string> {
  const h = await createXXHash128(0, 0);
  h.init();
  const size = new DataView(new ArrayBuffer(8));
  size.setBigUint64(0, BigInt(bytes.length), true);
  h.update(new Uint8Array(size.buffer));
  if (bytes.length < PARTIAL_SAMPLE_THRESHOLD) {
    h.update(bytes);
  } else {
    const mid = Math.floor(bytes.length / 2) - PARTIAL_WINDOW_BYTES / 2;
    h.update(bytes.subarray(0, PARTIAL_WINDOW_BYTES));
    h.update(bytes.subarray(mid, mid + PARTIAL_WINDOW_BYTES));
    h.update(bytes.subarray(bytes.length - PARTIAL_WINDOW_BYTES));
  }
  return h.digest('hex');
}

function file(bytes: Uint8Array): string {
  const path = join(tempDir(), 'clip.mov');
  writeFileSync(path, bytes);
  return path;
}

describe('content hasher', () => {
  it('matches the ADR’s known answers for "abc"', async () => {
    const abc = await hashBytes(new TextEncoder().encode('abc'));
    expect(abc.blake3).toBe('6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85');
    expect(abc.xxh128).toBe('06b05ab6733a618578af5f94892f3950');
    const full = await hasher.full(file(new TextEncoder().encode('abc')));
    expect(full).toEqual({ ok: true, value: abc.blake3 });
  });

  it('streams BLAKE3 over a file larger than one read', async () => {
    const bytes = randomBytes(PARTIAL_WINDOW_BYTES * 2 + 12_345);
    const full = await hasher.full(file(bytes));
    expect(full).toEqual({ ok: true, value: (await hashBytes(bytes)).blake3 });
  });

  it('samples size + first, middle and last MiB at 3 MiB and above, the whole file below', async () => {
    expect(partialWindows(10)).toEqual([[0, 10]]);
    expect(partialWindows(PARTIAL_SAMPLE_THRESHOLD)).toEqual([
      [0, PARTIAL_WINDOW_BYTES],
      [PARTIAL_WINDOW_BYTES, PARTIAL_WINDOW_BYTES],
      [2 * PARTIAL_WINDOW_BYTES, PARTIAL_WINDOW_BYTES],
    ]);
    expect([...sizePrefix(258)]).toEqual([2, 1, 0, 0, 0, 0, 0, 0]);
    for (const size of [
      0,
      5,
      PARTIAL_SAMPLE_THRESHOLD - 1,
      PARTIAL_SAMPLE_THRESHOLD,
      5 * PARTIAL_WINDOW_BYTES + 7,
    ]) {
      const bytes = randomBytes(size);
      const partial = await hasher.partial(file(bytes));
      expect(partial).toEqual({ ok: true, value: await referencePartial(bytes) });
    }
  });

  it('tells two big files apart that differ only in a sampled window, not elsewhere', async () => {
    const size = 8 * PARTIAL_WINDOW_BYTES;
    const a = randomBytes(size);
    const inWindow = Buffer.from(a);
    inWindow[size - 1] = (inWindow[size - 1]! + 1) % 256;
    const outside = Buffer.from(a);
    outside[2 * PARTIAL_WINDOW_BYTES] = (outside[2 * PARTIAL_WINDOW_BYTES]! + 1) % 256;
    const [pa, pin, pout] = await Promise.all([a, inWindow, outside].map((b) => hasher.partial(file(b))));
    expect(pin).not.toEqual(pa);
    // A candidate key only: the full BLAKE3 decides.
    expect(pout).toEqual(pa);
    expect(await hasher.full(file(outside))).not.toEqual(await hasher.full(file(a)));
  });

  it('returns errors as values: a missing file, a cancelled read', async () => {
    const missing = await hasher.full(join(tempDir(), 'gone.mov'));
    expect(missing.ok).toBe(false);
    const controller = new AbortController();
    controller.abort();
    const cancelled = await hasher.full(file(randomBytes(1000)), { signal: controller.signal });
    expect(!cancelled.ok && cancelled.error.code).toBe('core.cancelled');
  });
});
