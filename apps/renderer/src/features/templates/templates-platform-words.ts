// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Templates' sentences that name the Mac, and their words on every other computer (UX3-MAC; the kit's
 * platform-words.ts says how a pair works): the hub's owner error, Saved's sign-in and settings, a template's kept
 * reel (REF1), and the list's keys.
 */
import { msg } from '@lingui/core/macro';
import { macKey, type PlatformWords } from '@taalcut/ui';

export const TEMPLATES_PLATFORM_WORDS: readonly PlatformWords[] = [
  {
    mac: macKey('errors.hub.not_owner'),
    computer: msg({
      id: 'errors.hub.not_owner.computer',
      message: 'Only the computer that first shared this template can update it on the hub.',
    }),
  },
  {
    mac: msg`Sign in on instagram.com in a dedicated Taalcut window. Your session stays in your Mac’s Keychain, and each Reel’s video and music stay on this Mac with its template.`,
    computer: msg`Sign in on instagram.com in a dedicated Taalcut window. Your session stays in your system keyring, and each Reel’s video and music stay on this computer with its template.`,
    windows: msg`Sign in on instagram.com in a dedicated Taalcut window. Your session stays in Windows Credential Manager, and each Reel’s video and music stay on this computer with its template.`,
  },
  {
    // Saved on Instagram's settings (UX4 tpl): where the session is kept.
    mac: msg`Taalcut keeps the session in your Mac’s Keychain, and each Reel’s video and music on this Mac with its template.`,
    computer: msg`Taalcut keeps the session in your system keyring, and each Reel’s video and music on this computer with its template.`,
    windows: msg`Taalcut keeps the session in Windows Credential Manager, and each Reel’s video and music on this computer with its template.`,
  },
  {
    // REF1: a template's kept reel, on its overview (template/reel-media.tsx).
    mac: msg`The reel’s video and music are kept on this Mac`,
    computer: msg`The reel’s video and music are kept on this computer`,
  },
  {
    mac: msg`The reel’s video is kept on this Mac. It has no sound of its own.`,
    computer: msg`The reel’s video is kept on this computer. It has no sound of its own.`,
  },
  {
    // The list's keys, read by a screen reader: Ctrl where a Mac has Command.
    mac: msg`Space selects, Shift with an arrow selects a run, Command A selects all, Enter opens.`,
    computer: msg`Space selects, Shift with an arrow selects a run, Ctrl A selects all, Enter opens.`,
  },
];
