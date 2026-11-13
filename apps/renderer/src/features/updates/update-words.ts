// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Words for the update errors main reports (apps/desktop SPEC, "Errors (Phase 3)" and P1-B4's update checks), keyed
 * by their catalogue ids, so About says the cause and what happens next instead of "Something went wrong".
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { TaalcutError } from '@taalcut/core';
import { describeError } from '../settings/model-messages';

const UPDATE_ERRORS: readonly MessageDescriptor[] = [
  msg({
    id: 'errors.desktop.beta_terms_required',
    message: 'Agree to the beta terms first, then Taalcut can get beta updates.',
  }),
  msg({
    id: 'errors.desktop.update_unreadable',
    message: 'The update didn’t download cleanly, so it wasn’t installed. Check again to fetch it once more.',
  }),
  msg({
    id: 'errors.desktop.update_untrusted_signer',
    message: 'The update wasn’t signed by Taalcut, so it wasn’t installed. Nothing on this Mac changed.',
  }),
  msg({
    id: 'errors.desktop.update_not_newer',
    message: 'That update isn’t newer than this version, so Taalcut skipped it.',
  }),
  msg({
    id: 'errors.desktop.update_changed',
    message:
      'The update changed while Taalcut was checking it, so it wasn’t installed. Check again to retry.',
  }),
  // The channel file's signed envelope (desktop SPEC, manifest-check.ts): refused before anything is downloaded.
  msg({
    id: 'errors.desktop.update_manifest_missing',
    message:
      'The new version isn’t fully published yet, so nothing was downloaded. Taalcut checks again later.',
  }),
  msg({
    id: 'errors.desktop.update_manifest_unreadable',
    message: 'Taalcut couldn’t read the update details, so nothing was downloaded. Check again to retry.',
  }),
  msg({
    id: 'errors.desktop.update_manifest_untrusted',
    message:
      'The update details weren’t signed by Taalcut, so nothing was downloaded. Nothing on this Mac changed.',
  }),
  msg({
    id: 'errors.desktop.update_manifest_stale',
    message:
      'The update details are out of date or older than ones this Mac already has, so nothing was downloaded.',
  }),
  msg({
    id: 'errors.desktop.update_manifest_mismatch',
    message: 'The update didn’t match what Taalcut signed, so it wasn’t installed. Check again to retry.',
  }),
  msg({
    id: 'errors.desktop.update_not_ready',
    message: 'No update is ready to install yet. Taalcut says so here when one is.',
  }),
  // FIX-ERRWORDS: the check itself, and getting a staged update ready to install.
  msg({
    id: 'errors.desktop.update_check_failed',
    message: 'Taalcut couldn’t check for updates. Check your connection; Taalcut tries again later.',
  }),
  msg({
    id: 'errors.desktop.update_file_invalid',
    message:
      'A downloaded update file was damaged, so Taalcut set it aside. Check again to fetch a fresh copy.',
  }),
  msg({
    id: 'errors.desktop.update_guard_missing',
    message:
      'This copy of Taalcut can’t undo an update that goes wrong, so it won’t install one. Download the latest version from taalcut.app.',
  }),
  msg({
    id: 'errors.desktop.update_prep_failed',
    message: 'Taalcut couldn’t get ready to install the update. Try again.',
  }),
];

const BY_ID: ReadonlyMap<string, MessageDescriptor> = new Map(
  UPDATE_ERRORS.flatMap((descriptor) => (descriptor.id ? [[descriptor.id, descriptor] as const] : [])),
);

/** An update error in plain words; any other error as Settings says it. */
export function describeUpdateError(i18n: I18n, error: Pick<TaalcutError, 'messageKey' | 'params'>): string {
  const known = BY_ID.get(error.messageKey);
  return known ? i18n._({ ...known, values: error.params }) : describeError(i18n, error);
}

/** Whether a version is a prerelease (a beta keeps its version until a newer stable ships). */
export function isPrerelease(version: string): boolean {
  return version.includes('-');
}
