// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The signed-manifest gate as a packaged build runs it (SB-19): the key baked into this build, the network through
 * Electron (proxy settings and all, never a cache), and the anti-replay times in <userData>/updates.
 */
import { net } from 'electron';
import { createManifestCheck } from './manifest-check';
import { manifestKey } from './manifest-envelope';
import { createManifestGate, type ManifestGate } from './manifest-gate';
import { manifestSeenFile, seenSignatures } from './manifest-seen';

/**
 * The update manifest key, base64 of the raw Ed25519 public key (TAALCUT_UPDATE_PUBLIC_KEY). Replaced at bundle
 * time by packaging/build-settings.ts's defines; declared beside its only reader.
 */
declare const __TAALCUT_UPDATE_PUBLIC_KEY__: string;

/** The gate this build checks channel files with, or undefined when it bakes no key (then it doesn't update). */
export function bakedManifestGate(updatesDir: string): ManifestGate | undefined {
  const key = manifestKey(__TAALCUT_UPDATE_PUBLIC_KEY__);
  if (!key.ok) return undefined;
  return createManifestGate(
    createManifestCheck({
      fetch: (url) => net.fetch(url, { cache: 'no-store' }),
      key: key.value,
      seen: seenSignatures(manifestSeenFile(updatesDir)),
      now: Date.now,
    }),
  );
}
