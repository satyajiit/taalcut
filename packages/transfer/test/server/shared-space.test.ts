// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, ValidationError } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { startFixture } from '../support/harness';
import { beginUpload, pairPhone, tokenOf } from '../support/upload';

describe('Wi-Fi shared destination budget', () => {
  it('asks the shared budget before accepting an upload, including another import reservation', async () => {
    const reserve = vi.fn(async () => err(ValidationError({ field: 'space' })));
    const fx = await startFixture({ space: { reserve, consume: () => undefined, release: () => undefined } });
    try {
      const paired = await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: fx.pairing.pin });
      const credential = paired.credential;
      const upload = beginUpload({ fx, credential, data: Buffer.alloc(100), name: 'clip.mp4' });
      await expect(upload.done).rejects.toBeDefined();
      expect(reserve).toHaveBeenCalledWith(expect.any(String), 100);
    } finally {
      await fx.dispose();
    }
  });
});
