// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Privacy's and Usage's sentences that name the Mac, and their words on every other computer (UX3-MAC; the kit's
 * platform-words.ts says how a pair works): what leaves, Local only, the quality notes, Help improve Taalcut, the
 * spending tiles, and the run log's and feedback's lines about what leaves.
 */
import { msg } from '@lingui/core/macro';
import { macKey, type PlatformWords } from '@taalcut/ui';

export const PRIVACY_PLATFORM_WORDS: readonly PlatformWords[] = [
  // Privacy.
  { mac: msg`What leaves this Mac`, computer: msg`What leaves this computer` },
  { mac: msg`What leaves this Mac, and when.`, computer: msg`What leaves this computer, and when.` },
  {
    mac: msg`Keep everything on this Mac. Nothing of yours leaves it: no cloud models, uploads, reel links, feedback or usage counts, whichever profile Models has. Update checks and model downloads still run; they send nothing of yours.`,
    computer: msg`Keep everything on this computer. Nothing of yours leaves it: no cloud models, uploads, reel links, feedback or usage counts, whichever profile Models has. Update checks and model downloads still run; they send nothing of yours.`,
  },
  {
    mac: msg`Local only is on. Jobs with a model on this Mac use it; the others are off until you turn this off. The On this Mac profile in Models runs the most jobs here.`,
    computer: msg`Local only is on. Jobs with a model on this computer use it; the others are off until you turn this off. The On this computer profile in Models runs the most jobs here.`,
  },
  {
    mac: msg`Off while Local only is on: it has no model on this Mac.`,
    computer: msg`Off while Local only is on: it has no model on this computer.`,
  },
  { mac: msg`Runs on this Mac. Nothing leaves.`, computer: msg`Runs on this computer. Nothing leaves.` },
  {
    mac: msg({ message: 'Sends {sends} to <0>{providers}</0>, or runs on this Mac.' }),
    computer: msg({ message: 'Sends {sends} to <0>{providers}</0>, or runs on this computer.' }),
  },
  {
    mac: msg`Each check also sends a random ID made for this Mac, so a new version can reach some Macs first. It isn’t linked to you or your files, and Taalcut doesn’t log it.`,
    computer: msg`Each check also sends a random ID made for this computer, so a new version can reach some computers first. It isn’t linked to you or your files, and Taalcut doesn’t log it.`,
  },
  {
    mac: msg`Downloads what runs on this Mac. Sends nothing of yours.`,
    computer: msg`Downloads what runs on this computer. Sends nothing of yours.`,
  },
  {
    mac: msg`When Taalcut crashes: the error and where in the code it happened, the app and macOS versions, and your Mac’s chip. Paths and the names of you and your Mac are removed. No memory dumps, never your media. Starts from the next launch.`,
    computer: msg`When Taalcut crashes: the error and where in the code it happened, the app and system versions, and your computer’s processor. Paths and the names of you and your computer are removed. No memory dumps, never your media. Starts from the next launch.`,
  },

  // The quality notes (quality-labels.ts).
  {
    mac: macKey('privacy.quality.agent.lowerQuality'),
    computer: msg({
      id: 'privacy.quality.agent.lowerQuality.computer',
      message: 'The agent is simpler on this computer',
    }),
  },
  {
    mac: macKey('privacy.quality.vision.lowerQuality'),
    computer: msg({
      id: 'privacy.quality.vision.lowerQuality.computer',
      message: 'Descriptions are simpler on this computer',
    }),
  },
  {
    mac: macKey('privacy.quality.speech.lowerQuality'),
    computer: msg({
      id: 'privacy.quality.speech.lowerQuality.computer',
      message: 'Captions from speech are simpler on this computer',
    }),
  },
  {
    mac: macKey('privacy.quality.voice.lowerQuality'),
    computer: msg({
      id: 'privacy.quality.voice.lowerQuality.computer',
      message: 'Voice is simpler on this computer',
    }),
  },
  {
    mac: macKey('privacy.quality.music.lowerQuality'),
    computer: msg({
      id: 'privacy.quality.music.lowerQuality.computer',
      message: 'Generated music is simpler on this computer',
    }),
  },
  {
    mac: macKey('privacy.quality.images.lowerQuality'),
    computer: msg({
      id: 'privacy.quality.images.lowerQuality.computer',
      message: 'Generated images are simpler on this computer',
    }),
  },
  {
    mac: macKey('privacy.quality.job.lowerQuality'),
    computer: msg({
      id: 'privacy.quality.job.lowerQuality.computer',
      message: '{job}: simpler on this computer',
    }),
  },
  { mac: msg`Works the same on this Mac`, computer: msg`Works the same on this computer` },

  // Usage.
  {
    mac: msg({
      message: '{0, plural, =0 {None ran on this Mac} one {# on this Mac, free} other {# on this Mac, free}}',
    }),
    computer: msg({
      message:
        '{0, plural, =0 {None ran on this computer} one {# on this computer, free} other {# on this computer, free}}',
    }),
  },
  { mac: msg`Sent from this Mac`, computer: msg`Sent from this computer` },
  {
    mac: msg({ message: 'Run {job} on this Mac' }),
    computer: msg({ message: 'Run {job} on this computer' }),
  },
  { mac: msg`Use this Mac instead`, computer: msg`Use this computer instead` },
  {
    mac: msg({ message: 'Couldn’t move {job} to this Mac' }),
    computer: msg({ message: 'Couldn’t move {job} to this computer' }),
  },
  {
    mac: msg({ message: '{job} runs on this Mac now' }),
    computer: msg({ message: '{job} runs on this computer now' }),
  },

  // The run log, feedback and the beta's terms.
  { mac: msg`Sends something off this Mac`, computer: msg`Sends something off this computer` },
  { mac: msg`This Mac and the app’s version`, computer: msg`This computer and the app’s version` },
  {
    mac: macKey('onboarding.beta.line1'),
    computer: msg({
      id: 'onboarding.beta.line1.computer',
      message: 'Things can still break. Your clips stay on this computer.',
    }),
  },
];
