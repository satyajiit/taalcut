// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { StopReason } from '../session/connection';

export interface StoppedWords {
  /** What happened, as the band's first line. */
  readonly title: MessageDescriptor;
  /** What to do about it. */
  readonly next: MessageDescriptor;
  /** The band's one action: Try again when something outside Taalcut needs fixing first. */
  readonly action: MessageDescriptor;
}

const START_AGAIN = msg`Start again`;
const TRY_AGAIN = msg`Try again`;

/** Why the server isn't listening, in words, with the fix (transfer SPEC, "Sessions" and "Edge cases"). */
export function stoppedWords(reason: StopReason | undefined): StoppedWords {
  switch (reason) {
    case 'closed':
      return {
        title: msg`You stopped listening`,
        next: msg`Phones can’t reach this Mac.`,
        action: START_AGAIN,
      };
    case 'idle':
      return {
        title: msg`Stopped after 10 quiet minutes`,
        next: msg`Nothing on this network can reach your Mac now.`,
        action: START_AGAIN,
      };
    case 'no-network':
      return {
        title: msg`This Mac isn’t on Wi-Fi`,
        next: msg`Join the same Wi-Fi as your phone. Taalcut starts again by itself once this Mac is on a network.`,
        action: TRY_AGAIN,
      };
    case 'replaced':
      return {
        title: msg`Phone import opened in another window`,
        next: msg`Use that window, or start again here.`,
        action: START_AGAIN,
      };
    case 'bind-failed':
      return {
        title: msg`Taalcut couldn’t start listening`,
        next: msg`Another app may be using the network port. Quit apps that share files over the network, then try again.`,
        action: TRY_AGAIN,
      };
    case 'originals-offline':
      return {
        title: msg`The drive Taalcut keeps imports on isn’t connected`,
        next: msg`Connect it, then start again.`,
        action: START_AGAIN,
      };
    default:
      return { title: msg`Not listening`, next: msg`Phones can’t reach this Mac.`, action: START_AGAIN };
  }
}
