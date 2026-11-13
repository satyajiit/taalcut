// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's SpeechCleanupSource (C-10) in the agent process: the cached analysis of an asset's current content under
 * the current config, or null when there is none yet (the `audio.analyzeSpeech` job makes it). A stored file that
 * no longer parses, or belongs to other content, reads as null too.
 */
import {
  ok,
  speechCleanupAnalysisSchema,
  type AssetId,
  type AsyncResult,
  type SpeechCleanupSource,
} from '@taalcut/core';
import { CLEANUP_AUDIO_CONFIG } from './config';
import { speechKey, type DerivedJson } from './speech-files';

/** An asset's current content hash; null when the asset has no file. */
export interface AssetHashes {
  contentHash(assetId: AssetId, signal?: AbortSignal): AsyncResult<string | null>;
}

export function createSpeechCleanupSource(deps: {
  readonly assets: AssetHashes;
  readonly derived: DerivedJson;
}): SpeechCleanupSource {
  return {
    async get(assetId, signal) {
      const hash = await deps.assets.contentHash(assetId, signal);
      if (!hash.ok) return hash;
      if (!hash.value) return ok(null);
      const stored = await deps.derived.read(speechKey(hash.value), signal);
      if (!stored.ok) return stored;
      const parsed = speechCleanupAnalysisSchema.safeParse(stored.value);
      if (!parsed.success) return ok(null);
      const current =
        parsed.data.contentHash === hash.value &&
        parsed.data.configVersion === CLEANUP_AUDIO_CONFIG.configVersion;
      return ok(current ? parsed.data : null);
    },
  };
}
