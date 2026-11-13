// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The kit's sentences that name the Mac, and their words on every other computer (platform-words.ts): cards, the
 * voice consent, the error tables, the theme switcher, the export words. Each `mac` is the call site's own message.
 */
import { msg } from '@lingui/core/macro';
import { macKey, type PlatformWords } from './platform-words';

export const KIT_PLATFORM_WORDS: readonly PlatformWords[] = [
  // The machine as a name: About's section, the cost cards' local line, first run's rail.
  { mac: msg`This Mac`, computer: msg`This computer` },
  // The theme switcher and Settings › Language: follow what the system is set to.
  { mac: msg`Match the Mac`, computer: msg`Match the system` },

  // Cards: where a step runs, the library's first sources, the export targets.
  { mac: msg({ message: '{name} on this Mac' }), computer: msg({ message: '{name} on this computer' }) },
  { mac: msg`On this Mac, free`, computer: msg`On this computer, free` },
  {
    mac: msg`Add a folder on this Mac or a drive, or bring in clips from your phone over Wi-Fi or a cable.`,
    computer: msg`Add a folder on this computer or a drive, or bring in clips from your phone over Wi-Fi or a cable.`,
  },
  {
    mac: msg`Add a folder on this Mac or a drive, or send clips from your phone over Wi-Fi.`,
    computer: msg`Add a folder on this computer or a drive, or send clips from your phone over Wi-Fi.`,
  },
  {
    mac: msg`Your library is empty. Add a folder of videos on this Mac, or send them from your phone over Wi-Fi.`,
    computer: msg`Your library is empty. Add a folder of videos on this computer, or send them from your phone over Wi-Fi.`,
  },
  // FIX-ASK, the gapFix card's Add more clips.
  {
    mac: msg`Add clips from this Mac or your phone. Once they’re ready, Taalcut tries this shot again.`,
    computer: msg`Add clips from this computer or your phone. Once they’re ready, Taalcut tries this shot again.`,
  },
  { mac: msg`From this Mac`, computer: msg`From this computer` },
  { mac: msg`Send this off your Mac?`, computer: msg`Send this off your computer?` },
  { mac: msg`Sends data off this Mac.`, computer: msg`Sends data off this computer.` },
  {
    mac: msg`Sharing is off while Local only is on. Nothing leaves this Mac.`,
    computer: msg`Sharing is off while Local only is on. Nothing leaves this computer.`,
  },
  {
    mac: msg({ message: 'On this Mac, {name} answers without thinking, so it fits in memory.' }),
    computer: msg({ message: 'On this computer, {name} answers without thinking, so it fits in memory.' }),
  },
  { mac: msg`Save to this Mac`, computer: msg`Save to this computer` },
  { mac: msg`Save to this Mac (smaller file)`, computer: msg`Save to this computer (smaller file)` },
  {
    mac: macKey('render.presets.device'),
    computer: msg({ id: 'render.presets.device.computer', message: 'This computer (H.264)' }),
  },
  {
    mac: macKey('render.presets.deviceHevc'),
    computer: msg({ id: 'render.presets.deviceHevc.computer', message: 'This computer (HEVC)' }),
  },
  // Showing a file where it lives: the export cards here, and the Library's and Make's buttons, one name everywhere.
  {
    mac: msg`Show in Finder`,
    computer: msg({ message: 'Show in Files', comment: 'Files is the file manager on Ubuntu' }),
    windows: msg`Show in File Explorer`,
  },

  // EDT1-GFX: a proposed graphic's card, when it wears Taalcut's own design because the model is on-device.
  {
    mac: msg`It uses Taalcut’s own design: the model on this Mac doesn’t design graphics well. Choose a subscription model in Settings to have one designed for your video.`,
    computer: msg`It uses Taalcut’s own design: the model on this computer doesn’t design graphics well. Choose a subscription model in Settings to have one designed for your video.`,
  },

  // The style profile's summary in words.
  {
    mac: msg`No summary in words: there’s no model on this Mac that can look at frames, and pictures go to a cloud model only with your permission. Everything above is measured, so it’s complete without one.`,
    computer: msg`No summary in words: there’s no model on this computer that can look at frames, and pictures go to a cloud model only with your permission. Everything above is measured, so it’s complete without one.`,
  },
  {
    mac: msg`The model on this Mac is still getting ready, so there’s no summary in words yet.`,
    computer: msg`The model on this computer is still getting ready, so there’s no summary in words yet.`,
  },
  {
    mac: msg({ message: 'Written on this Mac by <0>{model}</0>, from the most typical videos’ frames.' }),
    computer: msg({
      message: 'Written on this computer by <0>{model}</0>, from the most typical videos’ frames.',
    }),
  },

  // Your own voice: the consent recording.
  {
    mac: msg`Read the line below in your own voice, then keep reading for about a minute. Taalcut checks on this Mac that it’s you saying the line and keeps the recording here. Nothing leaves this Mac until you choose Create my voice.`,
    computer: msg`Read the line below in your own voice, then keep reading for about a minute. Taalcut checks on this computer that it’s you saying the line and keeps the recording here. Nothing leaves this computer until you choose Create my voice.`,
  },
  {
    mac: msg`Taalcut can’t use the microphone. Turn it on in System Settings › Privacy & Security › Microphone, then start again.`,
    computer: msg`Taalcut can’t use the microphone. Allow microphone access in your system’s Settings, then start again.`,
    windows: msg`Taalcut can’t use the microphone. Turn it on in Settings › Privacy & security › Microphone, then start again.`,
  },
  {
    mac: msg`This Mac doesn’t let apps use the microphone (a profile or Screen Time limits it).`,
    computer: msg`This computer doesn’t let apps use the microphone (a policy set by its administrator limits it).`,
  },
  {
    mac: msg`Taalcut asks macOS for the microphone when you start.`,
    computer: msg`Taalcut turns on the microphone when you start.`,
  },
  {
    mac: msg`Checking it’s you saying the consent line… (on this Mac)`,
    computer: msg`Checking it’s you saying the consent line… (on this computer)`,
  },
  { mac: msg`Consent saved on this Mac.`, computer: msg`Consent saved on this computer.` },
  { mac: msg`Send your recording off this Mac?`, computer: msg`Send your recording off this computer?` },
  {
    mac: msg({
      message:
        'Withdrawing deletes your recording and your consent from this Mac, and your voice at <0>{provider}</0>. You can’t undo it.',
    }),
    computer: msg({
      message:
        'Withdrawing deletes your recording and your consent from this computer, and your voice at <0>{provider}</0>. You can’t undo it.',
    }),
  },
  {
    mac: msg`That consent isn’t saved on this Mac now.`,
    computer: msg`That consent isn’t saved on this computer now.`,
  },

  // The error tables (error-messages.ts, domain-error-messages.ts).
  {
    mac: macKey('errors.models.privacy_blocked'),
    computer: msg({
      id: 'errors.models.privacy_blocked.computer',
      message:
        'Local-only mode is on, so Taalcut kept this on your computer instead of sending it to the cloud.',
    }),
  },
  {
    mac: macKey('errors.models.budget_cap_exceeded'),
    computer: msg({
      id: 'errors.models.budget_cap_exceeded.computer',
      message: 'This project reached its spending cap. Raise the cap or use a model on this computer.',
    }),
  },
  {
    mac: macKey('errors.models.local_runtime_missing'),
    computer: msg({
      id: 'errors.models.local_runtime_missing.computer',
      message: 'The on-device model isn’t downloaded yet. Download it in Settings › Models.',
    }),
  },
  {
    mac: macKey('errors.models.local_runtime_failed'),
    computer: msg({
      id: 'errors.models.local_runtime_failed.computer',
      message: 'The model on this computer stopped unexpectedly. Try again.',
    }),
  },
  {
    mac: macKey('errors.models.local_out_of_memory'),
    computer: msg({
      id: 'errors.models.local_out_of_memory.computer',
      message:
        'This computer ran out of memory for that model. Close other apps or switch to a smaller model.',
    }),
  },
  {
    mac: macKey('errors.agent.consent_denied'),
    computer: msg({
      id: 'errors.agent.consent_denied.computer',
      message: 'Stopped so those clips stayed on this computer.',
    }),
  },
  {
    mac: macKey('errors.templates.fetch_failed'),
    computer: msg({
      id: 'errors.templates.fetch_failed.computer',
      message:
        'Couldn’t download that reference video. Check the link or choose a video file on your computer.',
    }),
  },
  {
    mac: macKey('errors.desktop.keychain_unavailable'),
    computer: msg({
      id: 'errors.desktop.keychain_unavailable.computer',
      message: 'The system keyring is locked or unavailable. Unlock it, then try again.',
      comment: 'The keyring is where the system keeps passwords: GNOME Keyring or KWallet on Linux',
    }),
    windows: msg({
      id: 'errors.desktop.keychain_unavailable.windows',
      message:
        'Windows Credential Manager is unavailable. Try again, and restart Windows if it keeps happening.',
    }),
  },
  {
    mac: macKey('fix.openComponents'),
    computer: msg({ id: 'fix.openComponents.computer', message: 'Open Models' }),
  },
  {
    mac: macKey('errors.sandbox.unavailable'),
    computer: msg({
      id: 'errors.sandbox.unavailable.computer',
      message: 'This step runs in a sandbox Taalcut doesn’t have on this computer yet, so it didn’t run.',
    }),
  },
];
