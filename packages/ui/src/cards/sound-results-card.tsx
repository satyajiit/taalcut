// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H4 E4 S5 R5 V4
 * Hallmark · component: soundResults card (EAR1-K2) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a step panel on the sunken bed (results, not a decision), like hubResults: what was
 *   searched, then up to 20 sounds best first, each with its name (plain text, translate="no"), its family (or "From
 *   your library"), a neutral verdict chip in words ("Strong match"; "Hint" for a genre or mood query), "Borderline"
 *   when the match sits on a verdict's line (D23), the provenance chip a bundled sound has (lane D's LicenceChip:
 *   "Code-made", "CC0") and a fitted sound's credit. A bank sound has Add on cuts: a follow-up to the run (sfx.addHits
 *   takes its soundId). No player: cards have none for audio
 * states: results · no results (one line) · hints only (a line saying genre and mood are hints) · adding (that row's
 *   button spins, the others wait) · sent or in the message box (a status line) · error (the cause, danger words);
 *   the buttons carry the eight states
 * motion: none of its own
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { CardOf } from '@taalcut/core';
import { useId } from 'react';
import { Chip } from '#components/badge';
import { Button } from '#components/button';
import { LicenceChip } from '../gaps/licence-chip';
import { VERB_ICONS } from '../icons/concepts';
import { MediaError } from '../media/media-lines';
import { useFollowUp, type FollowUp } from '../media/use-command';
import { UserContent } from './card-frame';
import {
  SOUND_BORDERLINE_LABEL,
  SOUND_FAMILY_LABELS,
  SOUND_HINT_LABEL,
  SOUND_VERDICT_LABELS,
} from './sound-words';

type Card = CardOf<'soundResults'>;
type Sound = Card['sounds'][number];

const keyOf = (sound: Sound) => `${sound.source}:${sound.soundId ?? sound.packItemId ?? sound.assetId ?? ''}`;

function SoundRow({ sound, followUp }: { sound: Sound; followUp: FollowUp }) {
  const { t, i18n } = useLingui();
  const titleId = useId();
  const add = sound.soundId ? `add:${sound.soundId}` : null;
  const title = sound.title;
  const soundId = sound.soundId;
  return (
    <li
      data-slot="sound-row"
      data-source={sound.source}
      data-verdict={sound.verdict ?? 'hint'}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg px-2 py-2.5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <UserContent id={titleId} translate="no" className="min-w-0 text-md font-medium text-ink">
            {sound.title}
          </UserContent>
          <Chip data-slot="sound-verdict">
            {i18n._(sound.verdict ? SOUND_VERDICT_LABELS[sound.verdict] : SOUND_HINT_LABEL)}
          </Chip>
          {sound.borderline ? (
            <Chip data-slot="sound-borderline">{i18n._(SOUND_BORDERLINE_LABEL)}</Chip>
          ) : null}
          {sound.licence ? <LicenceChip licence={sound.licence} /> : null}
        </span>
        <span className="type-meta text-ink-2">
          {sound.family ? i18n._(SOUND_FAMILY_LABELS[sound.family]) : t`From your library`}
        </span>
        {sound.credit ? (
          <UserContent translate="no" className="type-meta text-ink-2">
            {sound.credit}
          </UserContent>
        ) : null}
      </div>
      {add && soundId && followUp.can ? (
        <Button
          size="sm"
          variant="ghost"
          icon={VERB_ICONS.add}
          aria-describedby={titleId}
          loading={followUp.busy === add}
          disabled={followUp.busy !== null && followUp.busy !== add}
          onClick={() => void followUp.send(add, t`Add the sound “${title}” (${soundId}) on the cuts.`)}
        >
          {t`Add on cuts`}
        </Button>
      ) : null}
    </li>
  );
}

/** How the last Add on cuts went; nothing before the first. Adding hits is free, so no word about cost. */
function AddedLine({ followUp }: { followUp: FollowUp }) {
  const { t } = useLingui();
  if (followUp.error) return <MediaError error={followUp.error.error} />;
  if (!followUp.outcome) return null;
  return (
    <p role="status" data-slot="follow-up" className="m-0 text-sm text-ink-2">
      {followUp.outcome.outcome === 'sent'
        ? t`Sent to the chat.`
        : t`It’s in the message box. Press Send when you’re ready.`}
    </p>
  );
}

/** EAR1-K2: the sound effects sfx.searchSounds found, best first. */
export function SoundResultsCard({ card }: { card: Card }) {
  const { t } = useLingui();
  const followUp = useFollowUp(card.runId);
  const query = card.query;
  const hintsOnly = card.sounds.length > 0 && card.sounds.every((sound) => sound.verdict === null);
  return (
    <article
      data-slot="smart-card"
      data-card-type="soundResults"
      aria-label={t`Sound effects`}
      className="flex max-w-[42rem] flex-col gap-3 rounded-xl bg-panel p-4"
    >
      <header className="flex flex-col gap-1">
        <h3 className="m-0 text-lg font-semibold text-ink">{t`Sound effects`}</h3>
        <p className="m-0 text-sm text-ink-2">
          <Trans>
            Searched for{' '}
            <UserContent translate="no" className="text-ink">
              {query}
            </UserContent>
          </Trans>
        </p>
      </header>
      {card.sounds.length === 0 ? (
        <p className="m-0 text-sm text-ink">{t`No sound matched that description.`}</p>
      ) : (
        <ul aria-label={t`Sounds, best first`} className="m-0 flex list-none flex-col p-0">
          {card.sounds.map((sound) => (
            <SoundRow key={keyOf(sound)} sound={sound} followUp={followUp} />
          ))}
        </ul>
      )}
      {hintsOnly ? (
        <p className="m-0 type-meta text-ink-2">{t`Genre and mood are hints: Taalcut can’t judge them reliably by ear.`}</p>
      ) : null}
      <AddedLine followUp={followUp} />
    </article>
  );
}
