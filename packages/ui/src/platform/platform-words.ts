// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Words that name the machine, chosen by platform (UX3-MAC). A sentence that names the Mac is written once, at its
 * call site, as a Mac shows it: its text and id never change, so macOS users and the translations see no churn. What
 * it says on any other computer is a pair in a platform-words table: `mac` is the call site's message (the same text,
 * so the same id), `computer` says the same of this computer (Linux, and Windows unless `windows` names a part of its
 * own). The app loads each catalogue through `withPlatformWords`, so off a Mac the Mac's id carries the computer's
 * words for every call site at once (`<Trans>`, `t`, `msg`, the error tables), with no platform passed around, and
 * translators get whole sentences, never a noun spliced into one.
 *
 * The words off a Mac:
 * - the machine: "this computer", "your computer";
 * - the file manager: "Files" (Ubuntu's), "File Explorer" on Windows;
 * - the secret store: "the system keyring" (GNOME Keyring on Ubuntu), "Windows Credential Manager" on Windows;
 * - the settings app: "Settings";
 * - shortcut keys: Ctrl and Alt through `useShortcutFormat`, a placeholder in the sentence, never a glyph.
 *
 * What differs in more than words (a step only a Mac has, a control another OS lacks) is chosen where it shows, with
 * `onPlatform` or `usePlatformChoice`.
 */
import type { MessageDescriptor, Messages } from '@lingui/core';
import { useCallback } from 'react';
import { useHostPlatform, type HostPlatform } from './host-platform';

/** One sentence that names the Mac, and what it says elsewhere. Placeholders match across all three. */
export interface PlatformWords {
  /** The message as a Mac shows it: `msg` with the call site's text, or `macKey(id)` for an explicit id. */
  readonly mac: MessageDescriptor;
  /** Linux, and Windows unless `windows` is given: "this computer", "Files", "the system keyring", "Settings". */
  readonly computer: MessageDescriptor;
  /** Windows, where it names a part of its own: "File Explorer", "Windows Credential Manager". */
  readonly windows?: MessageDescriptor;
}

/** The Mac's side of a pair whose message has an explicit id (an error key, a key the backend sends). */
export function macKey(id: string): MessageDescriptor {
  return { id };
}

/** One value per platform: the Mac's, every other computer's, and Windows' own where it differs. */
export interface PlatformChoices<T> {
  readonly mac: T;
  readonly computer: T;
  readonly windows?: T;
}

/** The value `platform` takes: for what differs in more than words. */
export function onPlatform<T>(platform: HostPlatform, choices: PlatformChoices<T>): T {
  if (platform === 'mac') return choices.mac;
  if (platform === 'windows' && choices.windows !== undefined) return choices.windows;
  return choices.computer;
}

/** `onPlatform` for the platform the app provides (HostPlatformProvider). */
export function usePlatformChoice(): <T>(choices: PlatformChoices<T>) => T {
  const platform = useHostPlatform();
  return useCallback(<T>(choices: PlatformChoices<T>) => onPlatform(platform, choices), [platform]);
}

/** The descriptor `platform` shows for a pair. */
export function platformWordsOf(pair: PlatformWords, platform: HostPlatform): MessageDescriptor {
  return onPlatform(platform, pair);
}

/**
 * Off a Mac, the words for each Mac id in `pairs`, by that id; empty on a Mac. For code that looks a key up itself
 * (a backend key with a fallback, describeError): the same table the catalogue is loaded through.
 */
export function platformWordsById(
  pairs: Iterable<PlatformWords>,
  platform: HostPlatform,
): ReadonlyMap<string, MessageDescriptor> {
  const byId = new Map<string, MessageDescriptor>();
  if (platform === 'mac') return byId;
  for (const pair of pairs) {
    if (pair.mac.id !== undefined) byId.set(pair.mac.id, platformWordsOf(pair, platform));
  }
  return byId;
}

/**
 * A compiled catalogue as `platform` shows it: off a Mac each pair's Mac id carries the compiled words for this
 * platform, from the same catalogue (so a language without them yet falls back as Lingui does). A Mac's is the
 * catalogue itself.
 */
export function withPlatformWords(
  messages: Messages,
  platform: HostPlatform,
  pairs: Iterable<PlatformWords>,
): Messages {
  if (platform === 'mac') return messages;
  const out: Messages = { ...messages };
  for (const [macId, words] of platformWordsById(pairs, platform)) {
    const compiled = words.id === undefined ? undefined : messages[words.id];
    if (compiled !== undefined) out[macId] = compiled;
  }
  return out;
}
