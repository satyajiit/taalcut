// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Make's, the exports', the chat's, ⌘K's and the updates' sentences that name the Mac, and their words on every
 * other computer (UX3-MAC; the kit's platform-words.ts says how a pair works).
 */
import { msg } from '@lingui/core/macro';
import { macKey, type PlatformWords } from '@taalcut/ui';

export const MAKE_PLATFORM_WORDS: readonly PlatformWords[] = [
  // Make, the timeline and the exports.
  {
    mac: macKey('errors.core.local_only'),
    computer: msg({
      id: 'errors.core.local_only.computer',
      message:
        'Local only is on, so Taalcut kept this on your computer. {what, select, model {Turn it off in Privacy to use a cloud model.} upload {Turn it off in Privacy to send files to the cloud.} reference {Turn it off in Privacy to fetch a reference video.} feedback {Turn it off in Privacy to send feedback.} telemetry {Turn it off in Privacy to share usage data.} stock {Turn it off in Privacy to search stock footage.} hub {Turn it off in Privacy to use the template hub.} other {Turn it off in Privacy to go online.}}',
    }),
  },
  {
    mac: macKey('errors.timeline.media_missing'),
    computer: msg({
      id: 'errors.timeline.media_missing.computer',
      message: 'The clip’s original isn’t on this computer. Reconnect the drive or folder it was on.',
    }),
  },
  {
    mac: msg`It may have been deleted, or it is on another Mac. Your other projects are in Make.`,
    computer: msg`It may have been deleted, or it is on another computer. Your other projects are in Make.`,
  },
  {
    mac: macKey('errors.render.encode_failed'),
    computer: msg({
      id: 'errors.render.encode_failed.computer',
      message: 'The video couldn’t be encoded. Try again, and restart your computer if it keeps happening.',
    }),
  },
  {
    mac: msg`Couldn’t show it in Finder`,
    computer: msg({ message: 'Couldn’t show it in Files', comment: 'Files is the file manager on Ubuntu' }),
    windows: msg`Couldn’t show it in File Explorer`,
  },

  // The chat: a reel Taalcut can't download.
  {
    mac: msg`Press Shift-Command-5 to record it while it plays, then add the recording to your library.`,
    computer: msg`Record it with your system’s screen recorder while it plays, then add the recording to your library.`,
  },

  // ⌘K.
  {
    mac: macKey('commands.components.download'),
    computer: msg({
      id: 'commands.components.download.computer',
      message: 'Download everything this computer needs',
    }),
  },
  {
    mac: msg`Match the Mac’s light or dark setting`,
    computer: msg`Match the system’s light or dark setting`,
  },

  // Updates (update-words.ts).
  {
    mac: macKey('errors.desktop.update_untrusted_signer'),
    computer: msg({
      id: 'errors.desktop.update_untrusted_signer.computer',
      message:
        'The update wasn’t signed by Taalcut, so it wasn’t installed. Nothing on this computer changed.',
    }),
  },
  {
    mac: macKey('errors.desktop.update_manifest_untrusted'),
    computer: msg({
      id: 'errors.desktop.update_manifest_untrusted.computer',
      message:
        'The update details weren’t signed by Taalcut, so nothing was downloaded. Nothing on this computer changed.',
    }),
  },
  {
    mac: macKey('errors.desktop.update_manifest_stale'),
    computer: msg({
      id: 'errors.desktop.update_manifest_stale.computer',
      message:
        'The update details are out of date or older than ones this computer already has, so nothing was downloaded.',
    }),
  },
];
