// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main's sentences that name the Mac, and their words on every other computer (UX3-MAC), as the window's
 * (packages/ui platform-words.ts): the Mac's message keeps its text and id, and off a Mac main's catalogues are
 * loaded with this computer's words under the Mac's id (mainI18n). macOS's own usage descriptions (Info.plist) are
 * shown by macOS alone and have none. test/main-platform-words.test.ts fails on a sentence naming the Mac that is
 * in neither list.
 */
import type { MessageDescriptor, Messages } from '@lingui/core';
import type { MachineWords } from '../../platform/types';
import {
  DOWNLOADS_NOTIFY_MESSAGES,
  DOWNLOADS_STOP_REASONS,
  DOWNLOADS_STOPPED_MESSAGES,
} from './downloads-messages';

export interface MainPlatformWords {
  /** The message as a Mac shows it. */
  readonly mac: MessageDescriptor;
  /** Linux, and Windows unless `windows` is given. */
  readonly computer: MessageDescriptor;
  readonly windows?: MessageDescriptor;
}

export const MAIN_PLATFORM_WORDS: readonly MainPlatformWords[] = [
  {
    mac: DOWNLOADS_NOTIFY_MESSAGES.ready.body,
    computer: /*i18n*/ {
      id: 'notify.downloads.ready.body.computer',
      message: 'Everything this computer needs has downloaded. Its models work offline from now on.',
    },
  },
  {
    mac: DOWNLOADS_STOPPED_MESSAGES.everything,
    computer: /*i18n*/ {
      id: 'notify.downloads.stopped.everything.computer',
      message: 'Couldn’t download the models this computer needs',
    },
  },
  {
    mac: DOWNLOADS_STOP_REASONS.space,
    computer: /*i18n*/ {
      id: 'notify.downloads.reason.space.computer',
      message: 'This computer doesn’t have enough free space for them. Free up some space, then try again.',
    },
  },
];

/** Main's catalogues in `machine`'s words: off a Mac, each Mac id carries this computer's compiled words. */
export function withMainPlatformWords<L extends string>(
  catalogues: Readonly<Record<L, Messages>>,
  machine: MachineWords,
  pairs: readonly MainPlatformWords[] = MAIN_PLATFORM_WORDS,
): Readonly<Record<L, Messages>> {
  if (machine === 'mac') return catalogues;
  const words = (pair: MainPlatformWords) =>
    machine === 'windows' ? (pair.windows ?? pair.computer) : pair.computer;
  const out = {} as Record<L, Messages>;
  for (const locale of Object.keys(catalogues) as L[]) {
    const messages: Messages = { ...catalogues[locale] };
    for (const pair of pairs) {
      const { id } = words(pair);
      const compiled = id === undefined ? undefined : catalogues[locale][id];
      if (pair.mac.id !== undefined && compiled !== undefined) messages[pair.mac.id] = compiled;
    }
    out[locale] = messages;
  }
  return out;
}
