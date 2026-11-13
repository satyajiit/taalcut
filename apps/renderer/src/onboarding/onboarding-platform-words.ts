// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * First run's sentences that name the Mac, and their words on every other computer (UX3-MAC; the kit's
 * platform-words.ts says how a pair works). UX3-ONB's steps choose the computer's sentence themselves where they show
 * it (steps.ts, welcome.tsx, quiet-checks.tsx, thinking-ways.tsx and the sources); this table is the same pairs, so the guard
 * (test/platform-words.test.ts) knows each one has its words and any other call site gets them from the catalogue.
 * An explicit id's words for this computer are kept where the step defines them; here they are named by id.
 */
import { msg } from '@lingui/core/macro';
import { macKey, type PlatformWords } from '@taalcut/ui';

export const ONBOARDING_PLATFORM_WORDS: readonly PlatformWords[] = [
  // Welcome and the alpha's note.
  {
    mac: msg`Taalcut turns your own footage into short videos that follow the timing of a reel you like. Every video is made on this Mac.`,
    computer: msg`Taalcut turns your own footage into short videos that follow the timing of a reel you like. Every video is made on this computer.`,
  },
  {
    mac: msg`Your footage stays on this Mac unless a step you allow sends it. Settings › Privacy lists every step that did.`,
    computer: msg`Your footage stays on this computer unless a step you allow sends it. Settings › Privacy lists every step that did.`,
  },

  // What this Mac needs (UX4: downloaded quietly; its section shows on the last step only when it needs you).
  {
    mac: msg`The models for this Mac stopped downloading. Your video can still start.`,
    computer: msg`The models for this computer stopped downloading. Your video can still start.`,
  },
  { mac: macKey('onboarding.downloads.lead'), computer: { id: 'onboarding.downloads.lead.computer' } },

  // How Taalcut thinks: the ways and Local only.
  {
    mac: macKey('onboarding.thinking.apiKey.body'),
    computer: { id: 'onboarding.thinking.apiKey.body.computer' },
  },
  {
    mac: macKey('onboarding.thinking.local.title'),
    computer: { id: 'onboarding.thinking.local.title.computer' },
  },
  {
    mac: macKey('onboarding.thinking.local.body'),
    computer: { id: 'onboarding.thinking.local.body.computer' },
  },
  {
    mac: msg`Local only is on. Nothing leaves this Mac.`,
    computer: msg`Local only is on. Nothing leaves this computer.`,
  },
  {
    mac: msg`On this Mac, some jobs are simpler or wait for you to go online:`,
    computer: msg`On this computer, some jobs are simpler or wait for you to go online:`,
  },

  // Your clips: the step, the folder and the phone.
  { mac: macKey('onboarding.sources.body'), computer: { id: 'onboarding.sources.body.computer' } },
  {
    mac: macKey('onboarding.sources.folder.title'),
    computer: { id: 'onboarding.sources.folder.title.computer' },
  },
  {
    mac: msg`Taalcut reads every clip where it is, on this Mac. Nothing is uploaded or moved.`,
    computer: msg`Taalcut reads every clip where it is, on this computer. Nothing is uploaded or moved.`,
  },
  {
    mac: msg`This Mac is out of space. Free some up to carry on.`,
    computer: msg`This computer is out of space. Free some up to carry on.`,
  },
];
