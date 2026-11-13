// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** EAR1-K2: the soundResults card's words: a sound effect's family, and how well it fits what was asked. */
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type { ListenVerdict, SfxCategory } from '@taalcut/core';

export const SOUND_FAMILY_LABELS: Readonly<Record<SfxCategory, MessageDescriptor>> = {
  whoosh: msg({ message: 'Whoosh', comment: 'A kind of sound effect: a rush of air as something passes.' }),
  riser: msg({
    message: 'Riser',
    comment: 'A kind of sound effect: a sound that builds up and rises in pitch.',
  }),
  impact: msg({ message: 'Impact', comment: 'A kind of sound effect: a heavy hit, a boom or a thud.' }),
  hit: msg({ message: 'Hit', comment: 'A kind of sound effect: a short, light tap or click on a cut.' }),
};

/** The calibrated match's verdict; a hint (genre, mood, instruments, voice) has none. */
export const SOUND_VERDICT_LABELS: Readonly<Record<ListenVerdict, MessageDescriptor>> = {
  strong: msg({
    message: 'Strong match',
    comment: 'How well a sound fits what was asked. A short chip label.',
  }),
  plausible: msg({
    message: 'Plausible match',
    comment: 'How well a sound fits what was asked. A short chip label.',
  }),
  weak: msg({ message: 'Weak match', comment: 'How well a sound fits what was asked. A short chip label.' }),
  no_match: msg({ message: 'No match', comment: 'A sound doesn’t fit what was asked. A short chip label.' }),
};

export const SOUND_HINT_LABEL = msg({
  message: 'Hint',
  comment: 'A guess about a sound’s genre or mood that Taalcut can’t judge reliably. A short chip label.',
});

export const SOUND_BORDERLINE_LABEL = msg({
  message: 'Borderline',
  comment:
    'A sound’s match is close to the line between two verdicts, so it could be either. A short chip label.',
});
