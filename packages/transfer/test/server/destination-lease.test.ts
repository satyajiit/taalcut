// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, ok } from '@taalcut/core';
import { expect, it, vi } from 'vitest';
import { startFixture } from '../support/harness';
import { pairPhone, tokenOf, uploadAll, videoBytes } from '../support/upload';

it('retains the destination until stopped reception has finished its actual import handoff', async () => {
  const release = vi.fn();
  let finish!: () => void;
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const fx = await startFixture({
    retainDestination: async () => ok(release),
    importStaged: async () => {
      await completed;
      return ok({ assetId: newId<'Asset'>(), sourceId: newId<'Source'>(), duplicate: 'none' });
    },
  });
  try {
    const paired = await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: fx.pairing.pin });
    await uploadAll({ fx, credential: paired.credential, data: videoBytes(8192), name: 'clip.mov' });
    await fx.waitFor((item) => item.type === 'file' && item.file.state === 'importing');
    const stopping = fx.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(release).not.toHaveBeenCalled();
    finish();
    await stopping;
    expect(release).toHaveBeenCalledTimes(1);
  } finally {
    finish();
    await fx.dispose();
  }
});
