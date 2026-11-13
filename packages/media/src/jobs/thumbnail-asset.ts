// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `media.makeThumbnail`'s operation (IX-D4): the poster frame (from keyframes
 * since IX2-T2, on the host's decode profile), written to a temp directory
 * and moved into the derived cache under the key previews used for it, so
 * stored references stay valid.
 */
import type { AsyncResult } from '@taalcut/core';
import { derivedKey } from '../cache/layout';
import { makeThumbnail } from '../previews/thumbnail';
import { counted, PREVIEW_RECIPE, ref, storeDerived, type Phase2Host, type RunOptions } from './operate';
import type { MakeThumbnailJobInput, MakeThumbnailJobOutput } from './phase2-kinds';

export function thumbnailAsset(
  input: MakeThumbnailJobInput & RunOptions,
  host: Phase2Host,
): AsyncResult<Omit<MakeThumbnailJobOutput, 'decodes'>> {
  const key = derivedKey('thumbnail', input.contentHash, PREVIEW_RECIPE, 'jpg');
  return storeDerived(
    host,
    input.contentHash,
    { prefix: 'taalcut-thumbnail-', file: 'thumb.jpg', key },
    async (ctx, out) => {
      const profile = await host.decodeProfile?.();
      return makeThumbnail(input.path, input.plan, counted(ctx, input), out, {
        ...(input.signal ? { signal: input.signal } : {}),
        ...(profile ? { profile } : {}),
      });
    },
    ({ width, height }, bytes) => ({
      thumbnail: ref('thumbnail', key, bytes, 'image/jpeg', { width, height }),
    }),
  );
}
