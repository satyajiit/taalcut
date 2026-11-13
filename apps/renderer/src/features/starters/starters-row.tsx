// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Starters (Start from… › Starters, /templates/start; UX4 tpl) · system: DESIGN.md
 *   v0.6 + UX4 (design-tpl.md, "The Start from… card")
 * the bundled starters for this language as Start from… cards: each its structure as a storyboard on the viewer
 *   grey (the slots in their shots' tones, the roles' marks, the beats; it plays on hover or focus), its format's
 *   kind mark and name in this language, the footage it needs, its length and slots, then Use for a video (copied
 *   into your templates, then a chat makes the video) and Copy to my templates
 * states: loading (the "start-cards" bones, captured from the community's cards: the anatomy is one) · filled · error (the cause, Try again) · each card's own
 *   (start-card.tsx)
 * motion: one preview plays at a time, under the pointer or focus; nothing moves while the page is still
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { FormatId, StarterSummary } from '@taalcut/core';
import { Button, ErrorLine, Skeleton, StructurePreview, VERB_ICONS } from '@taalcut/ui';
import { useBackend } from '../../backend/backend';
import { useRpcQuery } from '../../backend/use-rpc';
import { isAppLocale } from '../../i18n/locales';
import { formatSeconds } from '../shared/format';
import { KindMark } from '../templates/kind-tile';
import { CardsFixture } from '../templates/start/community-card';
import { CARD_GRID, CardBones, StartCard } from '../templates/start/start-card';
import { starterChoice } from './starter-words';

/** A starter without a format of its own takes the format its footage suggests, for its icon and colour. */
const NEED_FORMAT: Readonly<Record<StarterSummary['needs'], FormatId>> = {
  'many-clips': 'vlog',
  'day-clips': 'dayInTheLife',
  'two-clips': 'beforeAfter',
  talking: 'talkingHead',
  steps: 'tutorial',
  product: 'ugcAd',
  conversation: 'podcastClip',
};

export function Starters() {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const locale = isAppLocale(i18n.locale) ? i18n.locale : 'en';
  const starters = useRpcQuery(
    (signal) => backend.templates.starters({ locale, forLibrary: false }, { signal }),
    [backend, locale],
  );

  if (starters.error && !starters.data)
    return (
      <div className="flex flex-col items-start gap-2">
        <ErrorLine error={starters.error} />
        <Button size="sm" icon={VERB_ICONS.retry} onClick={starters.reload}>
          {t`Try again`}
        </Button>
      </div>
    );
  return (
    <Skeleton name="start-cards" loading={!starters.data} fallback={<CardBones />} fixture={<CardsFixture />}>
      <ul aria-label={t`Starters`} className={CARD_GRID} data-slot="starters">
        {(starters.data ?? []).map((summary) => {
          const choice = starterChoice(i18n, summary);
          const name = choice.name;
          const length = formatSeconds(i18n, choice.seconds);
          return (
            <StartCard
              key={choice.starterId}
              data-starter={choice.starterId}
              title={choice.name}
              name={choice.name}
              mark={<KindMark formatId={summary.formatId ?? NEED_FORMAT[summary.needs]} />}
              preview={(playing) => (
                <StructurePreview
                  mode="strip"
                  look="viewer"
                  structure={summary.structure}
                  playing={playing}
                  describe={false}
                  label={t`Preview of ${name}`}
                  className="w-full"
                />
              )}
              line={choice.needs}
              facts={t`${length} · ${plural(choice.slotCount, { one: '# slot', other: '# slots' })}`}
              source={{ kind: 'starter', starterId: choice.starterId }}
            />
          );
        })}
      </ul>
    </Skeleton>
  );
}
