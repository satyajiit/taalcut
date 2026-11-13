// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The transfer service's port onto media in the lan process (P2-L3): an
 * upload is probed with the app's FFmpeg before it is filed, so the re-encode
 * check can tell an original from a phone's re-encoded copy. A file FFmpeg
 * can't read still imports; its verdict stays unknown (the service's rule).
 */
import { createMediaService } from '@taalcut/media';
import type { TransferMedia } from '@taalcut/transfer';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { mediaBinaries } from './media-jobs';

export function lanMedia(config: UtilityConfig): TransferMedia {
  // FFmpeg is found on the first upload, not when the lan process starts.
  const service = createMediaService({ resolver: mediaBinaries(config) });
  return {
    async probe(path, options) {
      const probed = await service.probe(path, options?.signal ? { signal: options.signal } : {});
      return probed.ok ? probed.value : { ok: false as const, error: probed.error };
    },
  };
}
