// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Library's sentences that name the Mac, and their words on every other computer (UX3-MAC; the kit's
 * platform-words.ts says how a pair works): the empty library, the clip page, and From your phone (its band, the
 * Wi-Fi way, Transfers and Help). What only a Mac has (Local Network, the cable today) is chosen where it shows.
 */
import { msg } from '@lingui/core/macro';
import type { PlatformWords } from '@taalcut/ui';

export const LIBRARY_PLATFORM_WORDS: readonly PlatformWords[] = [
  // The library and the clip page.
  {
    mac: msg`Taalcut sorts every clip where it is, on this Mac, so the agent can find the right shot. Nothing is uploaded or moved.`,
    computer: msg`Taalcut sorts every clip where it is, on this computer, so the agent can find the right shot. Nothing is uploaded or moved.`,
  },
  {
    mac: msg({
      message:
        '{left, plural, one {One step starts by itself once they’re on this Mac.} other {# steps start by themselves once they’re on this Mac.}}',
    }),
    computer: msg({
      message:
        '{left, plural, one {One step starts by itself once they’re on this computer.} other {# steps start by themselves once they’re on this computer.}}',
    }),
  },
  {
    mac: msg`The models are on this Mac. The steps start by themselves.`,
    computer: msg`The models are on this computer. The steps start by themselves.`,
  },
  // The clip's summary, when the describe step was skipped (clip-summary.tsx).
  {
    mac: msg`This Mac has no model that can describe clips.`,
    computer: msg`This computer has no model that can describe clips.`,
  },
  {
    mac: msg({
      message: 'To describe clips on this Mac instead, choose a model in <0>Settings › Models</0>.',
    }),
    computer: msg({
      message: 'To describe clips on this computer instead, choose a model in <0>Settings › Models</0>.',
    }),
  },
  // Show in Finder (the clip's facts) is the kit's pair: the export cards, Make and the Library share one name.

  // From your phone: the band, the Wi-Fi way and Transfers.
  { mac: msg`Your Mac is listening on Wi-Fi at`, computer: msg`Your computer is listening on Wi-Fi at` },
  {
    mac: msg`Nothing on this Mac listens on the network until you show the Wi-Fi code.`,
    computer: msg`Nothing on this computer listens on the network until you show the Wi-Fi code.`,
  },
  { mac: msg`Phones can’t reach this Mac.`, computer: msg`Phones can’t reach this computer.` },
  {
    mac: msg`Nothing on this network can reach your Mac now.`,
    computer: msg`Nothing on this network can reach your computer now.`,
  },
  { mac: msg`This Mac isn’t on Wi-Fi`, computer: msg`This computer isn’t on Wi-Fi` },
  {
    mac: msg`Join the same Wi-Fi as your phone. Taalcut starts again by itself once this Mac is on a network.`,
    computer: msg`Join the same Wi-Fi as your phone. Taalcut starts again by itself once this computer is on a network.`,
  },
  {
    mac: msg`No code while your Mac isn’t listening`,
    computer: msg`No code while your computer isn’t listening`,
  },
  {
    mac: msg`Your Mac isn’t listening on Wi-Fi yet. Show the code, scan it with your phone, and its clips show up here as they travel.`,
    computer: msg`Your computer isn’t listening on Wi-Fi yet. Show the code, scan it with your phone, and its clips show up here as they travel.`,
  },
  {
    mac: msg`A VPN or security app may stop your phone reaching this Mac. If the phone can’t connect, pause it and try again.`,
    computer: msg`A VPN or security app may stop your phone reaching this computer. If the phone can’t connect, pause it and try again.`,
  },
  // The cable is a Mac's for now (platform-features.ts): elsewhere, public Wi-Fi is simply to be avoided.
  {
    mac: msg`Clips travel over your Wi-Fi without encryption, so use this on a network you trust. On public Wi-Fi, bring them in with a cable instead.`,
    computer: msg`Clips travel over your Wi-Fi without encryption, so use this on a network you trust, never on public Wi-Fi.`,
  },

  // From your phone › Help.
  {
    mac: msg`Your phone and this Mac need to be on the same Wi-Fi. Guest and hotel networks often keep devices apart, so use your home or office network.`,
    computer: msg`Your phone and this computer need to be on the same Wi-Fi. Guest and hotel networks often keep devices apart, so use your home or office network.`,
  },
  {
    mac: msg`A VPN or security app can stop your phone reaching this Mac. Pause it while you send, then try again.`,
    computer: msg`A VPN or security app can stop your phone reaching this computer. Pause it while you send, then try again.`,
  },
  { mac: msg`The Mac’s firewall`, computer: msg`The firewall` },
  {
    mac: msg`If macOS asked whether Taalcut may accept incoming connections and you chose Deny, phones can’t connect. Allow Taalcut in System Settings, Network, Firewall, Options.`,
    computer: msg`If a firewall on this computer blocks incoming connections, phones can’t connect. Allow Taalcut through it, or pause it while you send.`,
  },
  {
    mac: msg`Allow Photos access in System Settings, then connect again.`,
    computer: msg`Allow Photos access in your system’s privacy settings, then connect again.`,
  },
  {
    mac: msg`Connect to grant Taalcut read access to your System Photo Library. If access was denied, allow Photos access in System Settings, then connect again. Taalcut never changes your Photos library.`,
    computer: msg`Connect to grant Taalcut read access to your photo library. If access was denied, allow access in your system’s privacy settings, then connect again. Taalcut never changes your photo library.`,
  },
  {
    mac: msg`Only originals already on this Mac can be read unless you allow selected iCloud downloads.`,
    computer: msg`Only originals already on this computer can be read unless you allow selected iCloud downloads.`,
  },
  {
    mac: msg`Use a card reader or the camera’s USB storage mode. The volume must appear in Finder. Camera Wi-Fi transfer is not supported. Keep all folders, segments and companions together.`,
    computer: msg`Use a card reader or the camera’s USB storage mode. The volume must appear in your file manager. Camera Wi-Fi transfer is not supported. Keep all folders, segments and companions together.`,
  },
];
