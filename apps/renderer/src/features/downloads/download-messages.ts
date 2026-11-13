// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import type { TaalcutError } from '@taalcut/core';
import { HOST_PLATFORMS, platformWordsById, type HostPlatform } from '@taalcut/ui';
import { DOWNLOAD_ERROR_PLATFORM_WORDS } from './downloads-platform-words';

/**
 * The component manager's errors (packages/jobs SPEC, "Errors"), as first run, Settings › Models and a clip waiting
 * for its model say them. ErrorLine finds them in the catalogue by their message key (`errors.jobs.*`). Without
 * them every download failure read "Something went wrong" (UX2-MODELS). `{component}` is the component's name
 * where the window knows it (use-model-downloads.ts `named`), else its id.
 */
export const DOWNLOAD_ERROR_MESSAGES = [
  msg({
    id: 'errors.jobs.downloads_space_low',
    message: 'The models this Mac needs don’t fit on its disk. Free up space and try again.',
  }),
  msg({
    id: 'errors.jobs.disk_space_low',
    message: 'Not enough space to download {component}. Free up space on this Mac and try again.',
  }),
  msg({
    id: 'errors.jobs.checksum_mismatch',
    message: '{component} didn’t download correctly, so it was deleted. Try again.',
  }),
  msg({
    id: 'errors.jobs.size_mismatch',
    message: 'The server sent a different file for {component}. Try again later.',
  }),
  msg({
    id: 'errors.jobs.download_failed',
    message: 'Couldn’t download {component}. Check your internet connection and try again.',
  }),
  msg({
    id: 'errors.jobs.download_rejected',
    message: 'The download server refused {component} (error {status}). Try again later.',
  }),
  msg({ id: 'errors.jobs.extract_failed', message: '{component} is damaged and can’t be installed.' }),
  msg({
    id: 'errors.jobs.install_failed',
    message: 'Couldn’t install {component}. Check that Taalcut can write to its storage folder.',
  }),
  msg({ id: 'errors.jobs.platform_unsupported', message: '{component} isn’t available for this Mac.' }),
  msg({ id: 'errors.jobs.component_unknown', message: 'Taalcut doesn’t know the component {component}.' }),
  // LNX1-TRM: an install of a component whose owner's terms (NVIDIA's for its CUDA libraries) aren't accepted.
  msg({
    id: 'errors.jobs.terms_not_accepted',
    message:
      '{component} is {owner}’s software, and you haven’t accepted {owner}’s terms for it. Review them in Settings › Models to install it.',
  }),
  msg({
    id: 'errors.jobs.manifest_invalid',
    message: 'The list of downloadable components is damaged. Reinstall Taalcut.',
  }),
  msg({
    id: 'errors.jobs.manifest_untrusted',
    message:
      'Taalcut couldn’t confirm that the list of downloadable components is genuine, so nothing was downloaded. Update or reinstall Taalcut.',
  }),
  // The fix on both disk-space errors (core's `system.openStorage`).
  msg({ id: 'fix.openStorageSettings', message: 'Open Storage Settings' }),
] as const;

/** Off a Mac, the key each error that names the Mac takes, by platform. */
const OFF_MAC = new Map(
  HOST_PLATFORMS.map((platform) => [platform, platformWordsById(DOWNLOAD_ERROR_PLATFORM_WORDS, platform)]),
);

/**
 * `error` with its words for this platform: off a Mac, an error that names the Mac points at its Linux or Windows
 * sentence, else the computer's (downloads-platform-words.ts, the table the catalogue is loaded through, so ErrorLine
 * says them even where it gets no platform). The jobs process sends one key everywhere; the window knows where it
 * runs. `platform_unsupported` is what a manifest with no build for this system says: on Linux and Windows that is a
 * build not hosted yet, so it says so ("ONNX Runtime isn't available for Linux yet").
 */
export function downloadErrorOn<T extends Pick<TaalcutError, 'messageKey'>>(
  error: T,
  platform: HostPlatform,
): T {
  const words = OFF_MAC.get(platform)?.get(error.messageKey);
  return words?.id ? { ...error, messageKey: words.id } : error;
}
