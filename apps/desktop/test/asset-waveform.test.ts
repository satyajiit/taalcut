// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** UX2: the clip page's sound lane reads a clip's waveform file from the media cache, in brief. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DerivedFileRef } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { cachedWaveformReader } from '../src/utility/roots/asset-waveform';

const HASH = 'ab'.repeat(32);
const ref: DerivedFileRef = {
  kind: 'waveform',
  key: `waveforms/ab/${HASH}.v1.bin`,
  bytes: 0,
  mimeType: 'application/octet-stream',
  recipe: 1,
};

/** A version-1 waveform file (media's previews/peaks.ts): header, then one min/max int16 pair per bucket. */
function waveformFile(bucketsPerSecond: number, pairs: readonly (readonly [number, number])[]): Buffer {
  const body = Buffer.alloc(12 + pairs.length * 4);
  body.writeUInt32LE(1, 0);
  body.writeUInt32LE(bucketsPerSecond, 4);
  body.writeUInt32LE(pairs.length, 8);
  pairs.forEach(([min, max], index) => {
    body.writeInt16LE(min, 12 + index * 4);
    body.writeInt16LE(max, 12 + index * 4 + 2);
  });
  return body;
}

function cacheWith(body?: Buffer): string {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-waveform-'));
  if (body) {
    mkdirSync(dirname(join(root, ref.key)), { recursive: true });
    writeFileSync(join(root, ref.key), body);
  }
  return root;
}

describe('cachedWaveformReader', () => {
  it('summarises the cached waveform file', async () => {
    const warned: string[] = [];
    const file = waveformFile(2, [
      [0, 16384],
      [-32768, 0],
    ]);
    const read = cachedWaveformReader(cacheWith(file), (line) => warned.push(line));
    expect(await read(ref)).toEqual({ bucketsPerSecond: 2, peaks: [0.5, 1] });
    expect(warned).toEqual([]);
  });

  it('answers null, quietly, when the cache evicted the file', async () => {
    const warned: string[] = [];
    expect(await cachedWaveformReader(cacheWith(), (line) => warned.push(line))(ref)).toBeNull();
    expect(warned).toEqual([]);
  });

  it('answers null and says why for a file that is not a waveform', async () => {
    const warned: string[] = [];
    const read = cachedWaveformReader(cacheWith(Buffer.from('not a waveform')), (line) => warned.push(line));
    expect(await read(ref)).toBeNull();
    expect(warned).toHaveLength(1);
  });

  it('never reads a key outside the cache or a ref of another kind', async () => {
    const read = cachedWaveformReader(cacheWith(waveformFile(2, [[0, 0]])), () => undefined);
    expect(await read({ ...ref, key: '../../etc/passwd' })).toBeNull();
    expect(await read({ ...ref, kind: 'proxy' })).toBeNull();
  });
});
