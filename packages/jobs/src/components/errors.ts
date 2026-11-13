// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every error the component manager can return. Message keys are
 * 'errors.<code>'; SPEC.md lists the catalogue text. Cancellation is core's
 * `core.cancelled`, so the job engine can treat it the same way everywhere.
 */
import { defineError, type FixAction } from '@taalcut/core';

/**
 * The fix button on a disk-space error: opens System Settings › General › Storage, where macOS shows what takes the
 * space (core's `system.openStorage` UI command; the window opens the pane through main).
 */
export const OPEN_STORAGE_SETTINGS: FixAction = {
  command: 'system.openStorage',
  labelKey: 'fix.openStorageSettings',
};

/**
 * Not enough free space to download and install a component. Not retryable:
 * trying again only helps after the user frees space, so the UI offers the fix.
 */
export const DiskSpaceLow = defineError<{ component: string; requiredBytes: number; availableBytes: number }>(
  'jobs.disk_space_low',
  { fix: OPEN_STORAGE_SETTINGS },
);

/**
 * Not enough free space for everything this Mac needs (UX2-DOWNLOADER): checked before the set starts, over what
 * is still to download and unpack plus the headroom, so nothing starts that can't finish. The fix opens Storage.
 */
export const DownloadsSpaceLow = defineError<{ requiredBytes: number; availableBytes: number }>(
  'jobs.downloads_space_low',
  { fix: OPEN_STORAGE_SETTINGS },
);

/** The downloaded file's sha256 is not the one in the manifest. The file has been deleted. */
export const ChecksumMismatch = defineError<{ component: string }>('jobs.checksum_mismatch', {
  retryable: true,
});

/** The server's file is not the size the manifest says (or sent more bytes than that). */
export const SizeMismatch = defineError<{ component: string; expectedBytes: number; actualBytes: number }>(
  'jobs.size_mismatch',
  { retryable: true },
);

/** Network trouble that outlasted the retries: no connection, timeouts, 5xx, a cut-off transfer. */
export const DownloadFailed = defineError<{ component: string }>('jobs.download_failed', { retryable: true });

/** Every mirror refused the request (404, 403, a redirect to plain http, ...). */
export const DownloadRejected = defineError<{ component: string; status: number }>('jobs.download_rejected');

/** The archive is corrupt or unsafe (path traversal, a link out of the install folder, too big). */
export const ExtractFailed = defineError<{ component: string }>('jobs.extract_failed');

/** A filesystem step failed (permissions, a folder that vanished). */
export const InstallFailed = defineError<{ component: string }>('jobs.install_failed', { retryable: true });

/** The manifest failed validation. `detail` has zod's report. */
export const ManifestInvalid = defineError('jobs.manifest_invalid');

/** Why a signed manifest was refused (src/components/signing). */
export type ManifestRefusal =
  /** The file is not `{ manifest, signatures }`. */
  | 'unsigned'
  /** No signature is by a key this build trusts. */
  | 'unknown_key'
  /** A trusted key's signature does not match the payload. */
  | 'bad_signature'
  /** Past its `notAfter`. */
  | 'expired'
  /** Its `sequence` is lower than one this install has already accepted. */
  | 'rollback'
  /** A release build that still trusts the development key. */
  | 'development_key'
  /** The trusted-key list itself is wrong (none, more than two, or a keyId that doesn't match its key). */
  | 'key_config';

/**
 * A manifest the app must not use: checked before any entry is read, so
 * nothing is downloaded from it. `detail` says what was wrong.
 */
export const ManifestUntrusted = defineError<{ reason: ManifestRefusal }>('jobs.manifest_untrusted');

/** The manifest has no artifact for this Mac's OS and architecture. */
export const PlatformUnsupported = defineError<{ component: string; platform: string }>(
  'jobs.platform_unsupported',
);

/** The id is neither in the manifest nor installed. */
export const ComponentUnknown = defineError<{ component: string }>('jobs.component_unknown');

/** Removing the component would break another installed component that needs it. */
export const ComponentRequired = defineError<{ component: string; requiredBy: string }>(
  'jobs.component_required',
);

/**
 * The component's owner licenses it to the person under terms they haven't accepted in the app (LNX1-TRM: the
 * manifest's `licence.acceptance`, e.g. NVIDIA's for cuda-runtime-13), or it needs such a component. Nothing is
 * downloaded; Settings › Models asks for the terms.
 */
export const TermsNotAccepted = defineError<{ component: string; owner: string }>('jobs.terms_not_accepted');
