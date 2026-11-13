// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Loopback throughput for a generated 2 GiB file. Opt-in:
 *   TAALCUT_TRANSFER_BENCH=1 pnpm --filter @taalcut/transfer exec vitest run bench/throughput.test.ts
 * Gate criterion 7 (a real phone, ≥ 20 MB/s) is a device-lab measurement.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Upload } from 'tus-js-client';
import { describe, expect, it } from 'vitest';
import { fileFingerprint } from '../src/names';
import { startFixture } from '../test/support/harness';
import { pairPhone, tokenOf } from '../test/support/upload';

const GIB = 2 * 1024 * 1024 * 1024;
const enabled = process.env.TAALCUT_TRANSFER_BENCH === '1';

describe.skipIf(!enabled)('loopback throughput', () => {
  it('uploads 2 GiB on 127.0.0.1', async () => {
    const path = join(tmpdir(), `taalcut-bench-${process.pid}.bin`);
    await writePattern(path, GIB);
    const fx = await startFixture();
    try {
      const credential = (await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: fx.pairing.pin }))
        .credential;
      const started = performance.now();
      await uploadFile(fx.base(), credential, path, GIB);
      const seconds = (performance.now() - started) / 1000;
      const megabytesPerSecond = GIB / 1_000_000 / seconds;
      process.stdout.write(
        `loopback 2 GiB ${megabytesPerSecond.toFixed(2)} decimal MB/s in ${seconds.toFixed(2)}s\n`,
      );
      expect(megabytesPerSecond).toBeGreaterThan(0);
      await fx.service.drained();
    } finally {
      await fx.dispose();
      await rm(path, { force: true });
    }
  }, 600_000);
});

function writePattern(path: string, size: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(path);
    const chunk = Buffer.alloc(1024 * 1024);
    chunk.writeUInt32BE(20, 0);
    chunk.write('ftyp', 4);
    chunk.write('mp42', 8);
    for (let offset = 20; offset < chunk.length; offset += 1) chunk[offset] = offset & 0xff;
    let left = size;
    let first = true;
    const write = (): void => {
      while (left > 0) {
        const slice = first ? chunk : chunk.subarray(20);
        first = false;
        const piece = left < slice.length ? slice.subarray(0, left) : slice;
        left -= piece.length;
        if (!stream.write(piece)) {
          stream.once('drain', write);
          return;
        }
      }
      stream.end(() => resolve());
    };
    stream.on('error', reject);
    write();
  });
}

function uploadFile(base: string, credential: string, path: string, size: number): Promise<void> {
  const upload = new Upload(createReadStream(path), {
    endpoint: `${base}/files`,
    uploadSize: size,
    chunkSize: 8 * 1024 * 1024,
    retryDelays: [],
    headers: { Authorization: `Bearer ${credential}` },
    metadata: {
      filename: 'bench.mov',
      filetype: 'video/quicktime',
      lastModified: '1',
      fingerprint: fileFingerprint({ name: 'bench.mov', size, lastModified: 1, type: 'video/quicktime' }),
    },
  });
  return new Promise((resolve, reject) => {
    upload.options.onSuccess = () => resolve();
    upload.options.onError = (error) => reject(error instanceof Error ? error : new Error(String(error)));
    upload.start();
  });
}
