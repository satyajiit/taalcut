// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: export row (UX4: the kit's ListRow) · system: DESIGN.md v0.6 + UX4
 * one ListRow in ListRows (hover pills on the canvas, like the projects): the export's poster, 40 px like a
 *   project's, dimmed while it runs; its name as written; the facts in one meta line (where it's for, length, size);
 *   the date at the row's end; under the name what it's doing, in words with an icon: a neutral bar (background
 *   work never runs violet), the stage, the percent in mono and the time left; or the QA line; or the cause. The
 *   row opens its video's timeline. Its actions form one column on every row: the next step in a fixed slot
 *   (Cancel, Show in Finder, Review, Try again: one style, each with its icon), Export again (a menu: another
 *   preset, More options…; off while it runs), More (⋯: Delete)
 * states: the ListRow's (default · hover · focus · active) · disabled (Export again while one runs) · loading (a
 *   pressed button spins until its command lands) · error (the toast with the cause; the row stays) · queued ·
 *   exporting · checking · fixing · ready · needs review · failed (its cause, or that none came back) · stopped
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { type RenderSnapshot } from '@taalcut/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  errorMessage,
  ListRow,
  presetLabel,
  ProviderLogo,
  QaSummaryLine,
  renderStageLabel,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { ChevronDown, CircleMinus, CircleX, SlidersHorizontal } from 'lucide-react';
import { useId } from 'react';
import { formatBytes, formatClipLength, formatDay, formatPercent } from '../shared/format';
import { Duration } from '../shared/time';
import { MakePoster } from '../make/make-poster';
import { PRESET_IDS, RUNNING, useRenderActions } from './render-actions';
import { useRenderPoster } from './use-render-media';

export interface RenderRowProps {
  render: RenderSnapshot;
  now: number;
  /** Opens the QA review (needs review). */
  onReview: (render: RenderSnapshot) => void;
  /** Opens the export dialog on this render's timeline. */
  onMoreOptions: (render: RenderSnapshot) => void;
}

function Progress({ render }: { render: RenderSnapshot }) {
  const { i18n } = useLingui();
  const fraction = render.progress?.fraction ?? 0;
  const stage = renderStageLabel(i18n, render.progress?.stageKey, render.status);
  const eta = render.progress?.etaMs;
  return (
    <div className="mt-1.5 flex w-full max-w-sm flex-col gap-1.5" data-slot="render-row-progress">
      <div
        role="progressbar"
        aria-label={stage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        className="h-1 w-full overflow-hidden rounded-pill bg-sunken"
      >
        <div
          className="h-full origin-left rounded-pill bg-ink-2 transition-transform duration-(--dur-short) ease-(--ease-out)"
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>
      <p className="m-0 flex flex-wrap gap-x-2 type-meta text-ink-2">
        <span className="text-ink">{stage}</span>
        {render.status === 'queued' ? null : (
          <span className="font-mono">{formatPercent(i18n, fraction)}</span>
        )}
        {eta !== undefined && eta > 0 ? (
          <span>
            <Trans>
              About <Duration ms={eta} /> left
            </Trans>
          </span>
        ) : null}
      </p>
    </div>
  );
}

/** What the export is doing, under its name: progress, its check, its cause or that it stopped. */
function Status({ render }: { render: RenderSnapshot }) {
  const { t, i18n } = useLingui();
  if (RUNNING.has(render.status)) return <Progress render={render} />;
  if ((render.status === 'ready' || render.status === 'needsAttention') && render.qa)
    return (
      <span className="mt-1 block">
        <QaSummaryLine summary={render.qa} />
      </span>
    );
  if (render.status === 'failed')
    return (
      <p className="m-0 mt-1 flex items-start gap-2 type-body text-ink" data-slot="render-row-error">
        <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-strong" />
        <span>
          {render.error
            ? `${t`Didn’t finish.`} ${errorMessage(i18n, render.error)}`
            : t`Didn’t finish, and no reason came back. Export it again.`}
        </span>
      </p>
    );
  if (render.status === 'cancelled')
    return (
      <p className="m-0 mt-1 flex items-center gap-2 type-body text-ink-2">
        <CircleMinus aria-hidden className="size-4 shrink-0" />
        {t`Stopped before it finished.`}
      </p>
    );
  return null;
}

export function RenderRow({ render, now, onReview, onMoreOptions }: RenderRowProps) {
  const { t, i18n } = useLingui();
  const actions = useRenderActions(render);
  const nameId = useId();
  const moreId = useId();
  const poster = useRenderPoster(render.id, `${render.status}:${render.finishedAt ?? 0}`);
  const running = RUNNING.has(render.status);
  const seconds = render.durationFrames / (render.rate.num / render.rate.den);
  const at = render.finishedAt ?? render.createdAt;
  const busy = actions.busy;

  const others = PRESET_IDS.filter((id) => id !== render.presetId || render.status !== 'ready');
  const facts = [
    presetLabel(i18n, render.presetId),
    render.durationFrames > 0 ? formatClipLength(i18n, seconds) : null,
    render.bytes !== null && render.status === 'ready' ? formatBytes(i18n, render.bytes) : null,
  ].filter(Boolean);

  // The next step: one style, each with its icon, in a slot of its own so the row's actions form a column.
  const next = running ? (
    <Button
      size="sm"
      icon={VERB_ICONS.stop}
      loading={busy === 'cancel'}
      onClick={() => void actions.cancel()}
    >
      {t`Cancel`}
    </Button>
  ) : render.status === 'ready' ? (
    <Button
      size="sm"
      icon={VERB_ICONS.reveal}
      loading={busy === 'reveal'}
      onClick={() => void actions.reveal()}
    >
      {t`Show in Finder`}
    </Button>
  ) : render.status === 'needsAttention' ? (
    <Button size="sm" icon={VERB_ICONS.open} onClick={() => onReview(render)}>
      {t`Review`}
    </Button>
  ) : render.status === 'failed' ? (
    <Button
      size="sm"
      icon={VERB_ICONS.retry}
      loading={busy === `export:${render.presetId}`}
      onClick={() => void actions.exportAs(render.presetId)}
    >
      {t`Try again`}
    </Button>
  ) : null;

  const exportAgain = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          icon={VERB_ICONS.export}
          disabled={running}
          loading={busy?.startsWith('export:') && render.status !== 'failed'}
        >
          {t`Export again`}
          <ChevronDown aria-hidden className="text-ink-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>{t`Export for`}</DropdownMenuLabel>
        {others.map((id) => (
          <DropdownMenuItem key={id} onSelect={() => void actions.exportAs(id)}>
            <ProviderLogo provider={id} size="xs" framed={false} aria-hidden />
            {presetLabel(i18n, id)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onMoreOptions(render)}>
          <SlidersHorizontal aria-hidden />
          {t`More options…`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const more = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-labelledby={`${moreId} ${nameId}`}
          loading={actions.deleting}
          icon={VERB_ICONS.more}
        >
          <span id={moreId} className="sr-only">
            {t`More for`}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem asChild>
          <Link
            to="/projects/$projectId/timeline"
            params={{ projectId: render.projectId }}
            search={{ timeline: render.timelineId }}
          >
            <VERB_ICONS.open aria-hidden />
            {t`Open the timeline`}
          </Link>
        </DropdownMenuItem>
        {running ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={actions.remove}>
              <VERB_ICONS.delete aria-hidden />
              {t`Delete export`}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <ListRow
      data-slot="render-row"
      data-status={render.status}
      data-render-id={render.id}
      title={
        <UserContent id={nameId} translate="no">
          {render.name}
        </UserContent>
      }
      leading={<MakePoster url={poster} dimmed={running} />}
      meta={
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          <ProviderLogo provider={render.presetId} size="xs" framed={false} aria-hidden />
          <span>{facts.join(' · ')}</span>
        </span>
      }
      trailingMeta={
        <time dateTime={new Date(at).toISOString()} className="font-sans">
          {formatDay(i18n, at, now)}
        </time>
      }
      action={
        <Link
          to="/projects/$projectId/timeline"
          params={{ projectId: render.projectId }}
          search={{ timeline: render.timelineId }}
        />
      }
      actions={
        <>
          <span data-slot="render-next" className="flex min-w-36 justify-end">
            {next}
          </span>
          {exportAgain}
          {more}
        </>
      }
    >
      <Status render={render} />
    </ListRow>
  );
}
