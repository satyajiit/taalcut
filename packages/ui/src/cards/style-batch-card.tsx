// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: styleBatch card (U8) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a step panel on the sunken bed (no frame, no stripe, no shadow): "Applied <look> to 8 videos", what was skipped
 *   and why in words ("2 videos have no captions"), each video as a row (its name, how it went, Open), and Undo all
 * states: default · skipped (warning words per reason) · nothing applied (every video skipped) · Undo all only
 *   while the batch is the newest app-wide change (else hidden: no out-of-order undo) · undoing (button loading,
 *   keeps focus) · undone (a status line; videos changed since are counted: their look stays) · undo failed (the
 *   error line) · long list (four rows, then "Show all") · no data (rows say "Video 3"; Open hidden without
 *   navigate). Undo all, Show all and Open are Buttons (eight states)
 * pre-emit critique: P4 H4 E4 S4 R4 V4
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { CardOf, ProjectId, TimelineId } from '@taalcut/core';
import { ArrowUpRight, Palette } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Badge } from '#components/badge';
import { Button } from '#components/button';
import { CAPTION_PRESET_LABELS } from '../looks/look-words';
import { useCardActions } from './card-actions';
import { useLiveTimeline } from './card-data';
import { UserContent } from './card-frame';

type Card = CardOf<'styleBatch'>;
type Outcome = 'applied' | Card['skipped'][number]['reason'];

const FOLD = 4;

function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const { t } = useLingui();
  if (outcome === 'applied')
    return (
      <Badge shape="chip" tone="success">
        {t`Applied`}
      </Badge>
    );
  return outcome === 'noCaptions' ? (
    <Badge shape="chip" tone="warning">{t`No captions`}</Badge>
  ) : (
    <Badge shape="chip" tone="neutral">{t`Changed since`}</Badge>
  );
}

function VideoRow(props: { projectId: ProjectId; timelineId: TimelineId; outcome: Outcome; n: number }) {
  const { t, i18n } = useLingui();
  const { navigate } = useCardActions();
  const timeline = useLiveTimeline(props.timelineId);
  const n = i18n.number(props.n);
  const title = timeline?.name;
  const nameId = useId();
  const openId = useId();
  const name = title ? <UserContent translate="no">{title}</UserContent> : t`Video ${n}`;
  return (
    <li className="flex min-h-9 items-center gap-3">
      <span id={nameId} className="min-w-0 flex-1 truncate text-sm text-ink">
        {name}
      </span>
      <OutcomeBadge outcome={props.outcome} />
      {navigate ? (
        // Named "Open" and the video's name from the row itself, so the name stays as written in every language.
        <Button
          size="sm"
          variant="ghost"
          aria-labelledby={`${openId} ${nameId}`}
          onClick={() =>
            navigate({ to: 'timeline', projectId: props.projectId, timelineId: props.timelineId })
          }
        >
          <ArrowUpRight aria-hidden />
          <span id={openId}>{t`Open`}</span>
        </Button>
      ) : null}
    </li>
  );
}

/** U8 (P3-V10, P3-V16): a look applied to several videos, with what was skipped. */
export function StyleBatchCard({ card }: { card: Card }) {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const look: ReactNode =
    card.apply.kind === 'style' ? (
      <UserContent>{card.apply.name}</UserContent>
    ) : (
      i18n._(CAPTION_PRESET_LABELS[card.apply.presetId])
    );
  // The skipped first: they are what the person may want to look at.
  const rows = [
    ...card.skipped.map((item) => ({ ...item, outcome: item.reason as Outcome })),
    ...card.applied.map((item) => ({ ...item, outcome: 'applied' as Outcome })),
  ];
  const noCaptions = card.skipped.filter((item) => item.reason === 'noCaptions').length;
  const changedSince = card.skipped.filter((item) => item.reason === 'changedSince').length;
  const count = card.applied.length;
  const shown = open ? rows : rows.slice(0, FOLD);

  return (
    <article
      data-slot="smart-card"
      data-card-type="styleBatch"
      aria-label={t`Look applied to videos`}
      className="flex max-w-[42rem] flex-col gap-3 rounded-xl bg-panel p-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Palette aria-hidden className="size-4 shrink-0 text-ink-2" />
        <h3 className="m-0 min-w-0 flex-1 text-md font-medium text-ink">
          {count > 0 ? (
            <Trans>
              Applied {look} to <Plural value={count} one="# video" other="# videos" />
            </Trans>
          ) : (
            <Trans>{look} fits none of these videos</Trans>
          )}
        </h3>
      </div>
      {noCaptions > 0 || changedSince > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-ink-2">
          {noCaptions > 0 ? (
            <li>
              <Plural
                value={noCaptions}
                one="# video has no captions, so it kept its look"
                other="# videos have no captions, so they kept their look"
              />
            </li>
          ) : null}
          {changedSince > 0 ? (
            <li>
              <Plural
                value={changedSince}
                one="# video was changed since; its look stays"
                other="# videos were changed since; their look stays"
              />
            </li>
          ) : null}
        </ul>
      ) : null}
      <ul aria-label={t`Videos`} className="m-0 flex list-none flex-col p-0">
        {shown.map((row, index) => (
          <VideoRow key={row.timelineId} {...row} n={index + 1} />
        ))}
      </ul>
      {rows.length > FOLD ? (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setOpen(!open)}>
          {open ? (
            t`Show fewer`
          ) : (
            <Plural value={rows.length} one="Show the # video" other="Show all # videos" />
          )}
        </Button>
      ) : null}
    </article>
  );
}
