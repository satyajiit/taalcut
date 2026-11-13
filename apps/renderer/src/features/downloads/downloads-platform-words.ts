// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Downloads' sentences that name the Mac, and their words on every other computer (UX3-MAC; the kit's
 * platform-words.ts says how a pair works): the component manager's errors (DownloadErrorLine swaps their keys by
 * this table too), the downloads summary and list, Models for this Mac and Getting ready. UX3-IDX's call sites choose
 * the computer's sentence themselves as well; both say the same.
 */
import { msg } from '@lingui/core/macro';
import { macKey, type PlatformWords } from '@taalcut/ui';

/** The component manager's errors (download-messages.ts) that name the Mac. */
export const DOWNLOAD_ERROR_PLATFORM_WORDS: readonly PlatformWords[] = [
  {
    // A manifest with no build for this system: on Linux and Windows that is a build not hosted yet (UX3-IDX).
    mac: macKey('errors.jobs.platform_unsupported'),
    computer: msg({
      id: 'errors.jobs.platform_unsupported.linux',
      message: '{component} isn’t available for Linux yet.',
    }),
    windows: msg({
      id: 'errors.jobs.platform_unsupported.windows',
      message: '{component} isn’t available for Windows yet.',
    }),
  },
  {
    mac: macKey('errors.jobs.downloads_space_low'),
    computer: msg({
      id: 'errors.jobs.downloads_space_low.computer',
      message: 'The models this computer needs don’t fit on its disk. Free up space and try again.',
    }),
  },
  {
    mac: macKey('errors.jobs.disk_space_low'),
    computer: msg({
      id: 'errors.jobs.disk_space_low.computer',
      message: 'Not enough space to download {component}. Free up space on this computer and try again.',
    }),
  },
];

export const DOWNLOADS_PLATFORM_WORDS: readonly PlatformWords[] = [
  ...DOWNLOAD_ERROR_PLATFORM_WORDS,
  // The summary, the list and the indicator.
  { mac: msg`Models for this Mac`, computer: msg`Models for this computer` },
  { mac: msg`What this Mac needs, by job`, computer: msg`What this computer needs, by job` },
  { mac: msg`Everything this Mac needs`, computer: msg`Everything this computer needs` },
  {
    mac: msg`Everything this Mac needs is downloaded.`,
    computer: msg`Everything this computer needs is downloaded.`,
  },
  {
    mac: msg({ message: 'Everything this Mac needs is here · {size}' }),
    computer: msg({ message: 'Everything this computer needs is here · {size}' }),
  },
  { mac: msg`Downloading what this Mac needs.`, computer: msg`Downloading what this computer needs.` },
  { mac: msg`Finding what this Mac needs…`, computer: msg`Finding what this computer needs…` },
  {
    mac: msg({ message: '{left} to download. This Mac has {free} free.' }),
    computer: msg({ message: '{left} to download. This computer has {free} free.' }),
  },
  {
    mac: msg({ message: 'They need {need} free. This Mac has {have}.' }),
    computer: msg({ message: 'They need {need} free. This computer has {have}.' }),
  },
  {
    mac: msg`Everything Taalcut runs on this Mac: speech, search, shots, beats, writing and more. Each part downloads once, then works offline.`,
    computer: msg`Everything Taalcut runs on this computer: speech, search, shots, beats, writing and more. Each part downloads once, then works offline.`,
  },
];
