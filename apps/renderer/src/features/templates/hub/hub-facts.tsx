// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4
 * Hallmark · component: hub facts (/templates/hub/$hubId) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.6 · the template's facts as a two-column description list, each term led by its icon (UX3:
 *   length, slots, tempo in rose, cuts on the beat, format as its kind chip, language, trend date, version,
 *   updated), then the licence line in plain words. A trend date over
 *   90 days old says what that means, as the Templates rows do (UX1: "Trend may be stale" in words)
 * states: n/a (static text)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { HubBrowseItem, HubTemplateV0 } from '@taalcut/core';
import { Chip, FormatChip, toSeconds, UserContent } from '@taalcut/ui';
import {
  AudioLines,
  CalendarClock,
  CircleAlert,
  Clock,
  History,
  Info,
  Languages,
  Layers,
  Shapes,
  Target,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDay, formatIsoDate, formatLanguage, formatPercent, formatSeconds } from '../../shared/format';
import { isTrendStale, STALE_AFTER_DAYS } from '../library/template-search';
import { HUB_FORMAT_NAMES } from './hub-words';

/** The trend date, and when it is old, what that means. */
function TrendDate({ date }: { readonly date: string }) {
  const { t, i18n } = useLingui();
  const days = i18n.number(STALE_AFTER_DAYS);
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <time dateTime={date} className="[font:inherit]">
        {formatIsoDate(i18n, date)}
      </time>
      {isTrendStale(date, Date.now()) ? (
        <>
          <Chip tone="warning">
            <CircleAlert aria-hidden />
            {t`Trend may be stale`}
          </Chip>
          <span className="text-ink-2">{t`Over ${days} days old: the sound or style may have moved on.`}</span>
        </>
      ) : null}
    </span>
  );
}

export function HubFacts({
  item,
  document,
}: {
  readonly item: HubBrowseItem;
  readonly document: HubTemplateV0;
}) {
  const { t, i18n } = useLingui();
  const { structure } = document;
  const bpm = structure.beatMap?.bpm;
  const onBeat = structure.pacing.cutsOnBeat;
  const version = i18n.number(item.version);
  const tempo = bpm ? i18n.number(Math.round(bpm)) : null;
  const handle = item.handle;
  const facts: [LucideIcon, string, ReactNode][] = [
    [Timer, t`Length`, formatSeconds(i18n, toSeconds(structure.duration))],
    [Layers, t`Slots`, i18n.number(structure.slots.length)],
  ];
  if (tempo) facts.push([AudioLines, t`Tempo`, t`${tempo} BPM`]);
  if (onBeat !== null) facts.push([Target, t`Cuts on the beat`, formatPercent(i18n, onBeat)]);
  if (item.formatId)
    facts.push([
      Shapes,
      t`Format`,
      <FormatChip formatId={item.formatId} label={i18n._(HUB_FORMAT_NAMES[item.formatId])} />,
    ]);
  if (item.language) facts.push([Languages, t`Language`, formatLanguage(i18n, item.language)]);
  if (item.trendFreshness)
    facts.push([CalendarClock, t`Trend date`, <TrendDate date={item.trendFreshness} />]);
  facts.push(
    [History, t`Version`, version],
    [
      Clock,
      t`Updated`,
      <time dateTime={new Date(item.updatedAt).toISOString()} className="[font:inherit]">
        {formatDay(i18n, item.updatedAt)}
      </time>,
    ],
  );
  return (
    <section aria-labelledby="hub-facts" className="flex flex-col gap-3">
      <h2 id="hub-facts" className="m-0 flex items-center gap-2 text-lg font-semibold text-ink">
        <Info aria-hidden className="size-5 text-ink-3" />
        {t`Facts`}
      </h2>
      <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 text-sm">
        {facts.map(([Icon, term, value]) => (
          <div key={term} className="contents">
            <dt className="flex items-center gap-2 text-ink-2">
              <Icon
                aria-hidden
                className={Icon === AudioLines ? 'size-4 text-beat-strong' : 'size-4 text-ink-3'}
              />
              {term}
            </dt>
            <dd className="m-0 text-ink tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p data-slot="hub-licence" className="m-0 max-w-prose text-sm text-ink-2">
        <Trans>
          CC0 1.0: anyone can use, change and share it without asking. Shared by{' '}
          <UserContent translate="no" className="text-ink">
            @{handle}
          </UserContent>
          .
        </Trans>
      </p>
    </section>
  );
}
