// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the last step, Kaatu's moment (UX4) · genre: atmospheric studio app (brand moment) · system: DESIGN.md
 *   "Mascot" (UX4 moments) + _orch/ux4/specs/design-onb.md
 * first run's end. Before a choice, a tip in the editor's voice (any reel works: Taalcut copies its cuts and beats,
 *   never its footage). Once a reel, a starter or a description is in and something can think, Kaatu grins and says
 *   what will happen, specific to the choice, right above the one primary, Make my first video: the peak the first
 *   run ends on. Just after a way to think starts working, it says so first.
 * states: tip · success (polite status: connected, or ready with a reel, a recording, a starter or your words)
 */
import { Trans } from '@lingui/react/macro';
import { KaatuMoment, UserContent } from '@taalcut/ui';

/** What the finish will start, as the moment names it. */
export type FinishReady =
  | { readonly kind: 'link' }
  | { readonly kind: 'file'; readonly name: string }
  | { readonly kind: 'starter'; readonly name: string }
  | { readonly kind: 'describe' };

export function FinishMoment({ ready, connected }: { ready: FinishReady | null; connected: boolean }) {
  // Named, so the catalogue says what goes there: a recording's file name, or a starter's name.
  const name = ready && 'name' in ready ? ready.name : '';
  if (ready)
    return (
      <KaatuMoment tone="success">
        {ready.kind === 'link' ? (
          <Trans>That’s all it takes. Taalcut reads the reel, then cuts your clips to its beat.</Trans>
        ) : ready.kind === 'file' ? (
          <Trans>
            That’s all it takes. Taalcut reads <UserContent translate="no">{name}</UserContent>, then cuts
            your clips to its beat.
          </Trans>
        ) : ready.kind === 'starter' ? (
          <Trans>
            That’s all it takes. Taalcut fills “<UserContent translate="no">{name}</UserContent>” with your
            best clips.
          </Trans>
        ) : (
          <Trans>That’s all it takes. Taalcut plans it from your words, then picks your clips.</Trans>
        )}
      </KaatuMoment>
    );
  if (connected)
    return (
      <KaatuMoment tone="success">
        <Trans>Connected. Now pick what your video follows.</Trans>
      </KaatuMoment>
    );
  return (
    <KaatuMoment tone="tip">
      <Trans>
        Any reel you like works, in any language. Taalcut copies its cuts and beats, never its footage.
      </Trans>
    </KaatuMoment>
  );
}
