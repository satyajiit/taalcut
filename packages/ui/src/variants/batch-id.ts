// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { RenderBatchId } from '@taalcut/core';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A new batch id for `render.exportBatch` (the caller names the batch, so a retry is the same batch): a ULID as
 * core's newId makes it (48-bit time, 80 random bits, Crockford base32), here because the kit may import only
 * core's types.
 */
export function newBatchId(now = Date.now()): RenderBatchId {
  let time = '';
  let rest = now;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD.charAt(rest % 32) + time;
    rest = Math.floor(rest / 32);
  }
  // 256 is a multiple of 32, so a byte's remainder is uniform.
  const random = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    CROCKFORD.charAt(byte % 32),
  );
  return `${time}${random.join('')}` as RenderBatchId;
}
