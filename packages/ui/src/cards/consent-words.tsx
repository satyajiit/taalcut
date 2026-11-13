// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import type { ReactNode } from 'react';
import { UserContent } from './card-frame';
import { providerLabel } from './labels';

type Card = CardOf<'consent'>;

export const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

/** Names, not ids ("Google", not "google"), joined the way this language lists things; null when none. */
function useProviders(card: Card): ReactNode {
  const { i18n } = useLingui();
  const names = card.upload.providers.map((provider) => providerLabel(i18n, provider));
  if (names.length === 0) return null;
  const joined = new Intl.ListFormat(i18n.locale === 'en-XA' ? 'en' : i18n.locale, {
    type: 'conjunction',
  }).format(names);
  // Provider names are product names: shown as is, not translated.
  return <UserContent>{joined}</UserContent>;
}

/** One file, by its name, marked when it is the reference's rather than your own. */
function OneFile({ card }: { card: Card }) {
  const name = <UserContent>{fileName(card.upload.files[0] ?? '')}</UserContent>;
  return card.upload.sources?.[0] === 'reference' ? <Trans>the reference’s {name}</Trans> : name;
}

/**
 * The step in words, then what leaves and where to (UX round 1): "Describing IMG_0418.MOV sends one frame of it to
 * Google." A step without words of its own says what its cloud module sends. More than one file: the count here,
 * the names in the list under it.
 */
export function ConsentSentence({ card }: { card: Card }) {
  const to = useProviders(card);
  const count = card.upload.files.length;
  const one = count === 1;
  const file = one ? <OneFile card={card} /> : null;
  const files = <Plural value={count} one="# file" other="# files" />;

  if (card.tool === 'vision.describeFrame') {
    if (one)
      return to ? (
        <Trans>
          Describing {file} sends one frame of it to {to}.
        </Trans>
      ) : (
        <Trans>Describing {file} sends one frame of it to the cloud.</Trans>
      );
    return to ? (
      <Trans>
        Describing these {files} sends one frame of each to {to}:
      </Trans>
    ) : (
      <Trans>Describing these {files} sends one frame of each to the cloud:</Trans>
    );
  }
  // EAR1-X1: the sound itself goes to a hosted model to be judged. The card is the feature's warning: what leaves,
  // that the provider keeps it on its terms, what comes back, and what stays on this computer instead. "Don't send" is the
  // safe answer. EAR1-R3: the call names an asset, an artifact or a template's reel by id; the agent names it here
  // (its file name, label or template name), so the person sees which sound goes before allowing it.
  if (card.tool === 'audio.cloudCritique' && file)
    return to ? (
      <Trans>
        Critiquing {file} uploads its audio to {to}: a mono copy, never the picture. {to} may keep it under
        its own terms, and its answer is an AI opinion, not a measurement. Taalcut’s own sound check stays on
        this computer.
      </Trans>
    ) : (
      <Trans>
        Critiquing {file} uploads its audio to the cloud: a mono copy, never the picture. The provider may
        keep it under its own terms, and its answer is an AI opinion, not a measurement. Taalcut’s own sound
        check stays on this computer.
      </Trans>
    );
  if (card.tool === 'audio.cloudCritique')
    return to ? (
      <Trans>
        Critiquing this sound uploads its audio to {to}: a mono copy, never the picture. {to} may keep it
        under its own terms, and its answer is an AI opinion, not a measurement. Taalcut’s own sound check
        stays on this computer.
      </Trans>
    ) : (
      <Trans>
        Critiquing this sound uploads its audio to the cloud: a mono copy, never the picture. The provider may
        keep it under its own terms, and its answer is an AI opinion, not a measurement. Taalcut’s own sound
        check stays on this computer.
      </Trans>
    );
  // HFW1: the Designer's stills over the person's video, shown to the run's model (no file of theirs is named).
  if (card.tool === 'workspace.renderOver')
    return to ? (
      <Trans>Checking this graphic shows stills of your video with it on top to {to}.</Trans>
    ) : (
      <Trans>Checking this graphic shows stills of your video with it on top to the cloud.</Trans>
    );
  if (card.tool === 'vision.detectShots') {
    if (one)
      return to ? (
        <Trans>
          Finding the shots in {file} sends frames of it to {to}.
        </Trans>
      ) : (
        <Trans>Finding the shots in {file} sends frames of it to the cloud.</Trans>
      );
    return to ? (
      <Trans>
        Finding the shots in these {files} sends frames of each to {to}:
      </Trans>
    ) : (
      <Trans>Finding the shots in these {files} sends frames of each to the cloud:</Trans>
    );
  }
  const what = card.upload.modules.includes('speech') ? (
    one ? (
      <Trans>the sound of {file}</Trans>
    ) : (
      <Trans>the sound of these {files}</Trans>
    )
  ) : card.upload.modules.includes('vision') ? (
    one ? (
      <Trans>frames of {file}</Trans>
    ) : (
      <Trans>frames of these {files}</Trans>
    )
  ) : one ? (
    file
  ) : (
    <Trans>these {files}</Trans>
  );
  if (one)
    return to ? (
      <Trans>
        This step sends {what} to {to}.
      </Trans>
    ) : (
      <Trans>This step sends {what} to the cloud.</Trans>
    );
  return to ? (
    <Trans>
      This step sends {what} to {to}:
    </Trans>
  ) : (
    <Trans>This step sends {what} to the cloud:</Trans>
  );
}
