// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Why a channel file was refused (security review SB-19, manifest-check.ts). Each is reported as an UpdateEvent
 * `rejected`; nothing is downloaded or staged after one. `detail` says which check failed, never the signature or
 * the key.
 */
import { defineError } from '@taalcut/core';

/** The feed has a channel file but no signature for it. A half-finished upload heals on the next check. */
export const UpdateManifestMissing = defineError<{ channel: string }>('desktop.update_manifest_missing', {
  retryable: true,
});
/** The channel file or its signature is malformed, too large, or couldn't be read. */
export const UpdateManifestUnreadable = defineError<{ channel: string }>(
  'desktop.update_manifest_unreadable',
  {
    retryable: true,
  },
);
/** The signature doesn't verify with the key this build trusts, or it was made for another channel. */
export const UpdateManifestUntrusted = defineError<{ channel: string }>('desktop.update_manifest_untrusted');
/** The signature ran out, or it is older than one this Mac already accepted (a replayed file). */
export const UpdateManifestStale = defineError<{ channel: string }>('desktop.update_manifest_stale');
/**
 * The bytes don't match what was signed: the channel file changed after signing, or the update library was offered
 * or downloaded something other than the signed file names.
 */
export const UpdateManifestMismatch = defineError<{ channel: string }>('desktop.update_manifest_mismatch', {
  retryable: true,
});
