// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, describe, expect, it } from 'vitest';
import { fileFingerprint } from '../../src/names';
import { TRANSFER_LIMITS } from '../../src/limits';
import { httpCall, manualClock, startFixture, type Fixture } from '../support/harness';
import { beginUpload, pairPhone, tokenOf, uploadAll, videoBytes } from '../support/upload';

const MIB = 1024 * 1024;

describe('upload lookup', () => {
  let fx: Fixture | undefined;

  afterEach(async () => {
    await fx?.dispose();
    fx = undefined;
  });

  it('resumes an unfinished upload and skips one already received', async () => {
    const clock = manualClock();
    fx = await startFixture({ clock });
    const credential = (await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: fx.pairing.pin }))
      .credential;
    const data = videoBytes(2 * MIB);
    const name = 'same.mov';
    const lastModified = 1_700_000_000_000;
    const partial = beginUpload({
      fx,
      credential,
      data,
      name,
      lastModified,
      chunkSize: MIB,
      abortAfter: MIB,
    });
    await partial.paused;
    const open = await lookup(fx, credential, {
      name,
      size: data.length,
      lastModified,
      type: 'video/quicktime',
    });
    expect(open.matches).toHaveLength(1);
    expect(open.matches[0]?.state).toBe('uploading');
    expect(open.matches[0]?.offset).toBeGreaterThan(0);
    expect(open.matches[0]?.uploadId).toBe(new URL(partial.upload.url ?? '').pathname.split('/').pop());

    await uploadAll({
      fx,
      credential,
      data,
      name,
      lastModified,
      chunkSize: MIB,
      uploadUrl: partial.upload.url ?? undefined,
    });
    await fx.service.drained();
    const done = await lookup(fx, credential, {
      name,
      size: data.length,
      lastModified,
      type: 'video/quicktime',
    });
    expect(['imported', 'duplicate', 'received']).toContain(done.matches[0]?.state);

    clock.set(clock.now() + TRANSFER_LIMITS.partialTtlMs - 1_000);
    await httpCall({
      host: fx.address,
      port: fx.port,
      path: '/api/session',
      headers: { authorization: `Bearer ${credential}` },
    });
    clock.set(clock.now() + 3_000);
    const stale = await lookup(fx, credential, {
      name,
      size: data.length,
      lastModified,
      type: 'video/quicktime',
    });
    expect(stale.matches).toEqual([]);
  });

  it('uses the same fingerprint the phone sends', () => {
    const file = { name: 'clip.mov', size: 10, lastModified: 5, type: 'video/quicktime' };
    expect(fileFingerprint(file)).toBe('clip.mov\n10\n5\nvideo/quicktime');
  });
});

async function lookup(
  fx: Fixture,
  credential: string,
  file: { name: string; size: number; lastModified: number; type: string },
): Promise<{ matches: Array<{ index: number; uploadId: string; offset: number; state: string }> }> {
  const res = await httpCall({
    host: fx.address,
    port: fx.port,
    method: 'POST',
    path: '/api/uploads/lookup',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    body: JSON.stringify({ files: [file] }),
  });
  expect(res.status).toBe(200);
  return JSON.parse(res.body) as {
    matches: Array<{ index: number; uploadId: string; offset: number; state: string }>;
  };
}
