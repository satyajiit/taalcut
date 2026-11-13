// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a template's library facts (template page) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6
 * one unboxed line under the intro (UX3: the trend date led by its icon, a stale one's chip by the warning's): Favourite (a toggle), its folder (a menu), its tags (soft chips, Edit tags…),
 *   its trend date (Trend may be stale in the warning wash, and why in words beside it: UX1; Set or change in
 *   place) and where it came from (a hub copy's maker and licence, a file, a starter). Favourite's star fills in
 *   ink, never a second marigold. An older version shows them, read-only.
 * states: controls default · hover · focus-visible (base ring) · active (pressed) · disabled (older version) ·
 *   loading (the running one's spinner) · error (toast with the cause) · success (toast with Undo); Favourite on
 *   (filled star, aria-pressed)
 * pre-emit critique: P5 H5 E4 S5 R4 V4
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { TEMPLATE_COMMANDS, type Template, type TemplateFolder, type TemplateSummary } from '@taalcut/core';
import {
  Button,
  Chip,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  UserContent,
} from '@taalcut/ui';
import { CalendarClock, ChevronDown, CircleAlert, Folder, Star, Tag } from 'lucide-react';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { formatDay, formatIsoDate } from '../../shared/format';
import { starterName } from '../../starters/starter-words';
import { TagDialog } from './tag-dialog';
import { isTrendStale, STALE_AFTER_DAYS } from './template-search';
import { TrendDateField } from './trend-date-field';
import { useLibraryCommands } from './use-library-commands';

export interface TemplateLibraryFactsProps {
  readonly summary: TemplateSummary;
  readonly template: Template;
  /** An older version is read-only. */
  readonly readOnly: boolean;
}

const NONE = '__none';

function Provenance({ summary }: { summary: TemplateSummary }) {
  const { i18n } = useLingui();
  const from = summary.provenance;
  if (!from) return null;
  if (from.kind === 'hub') {
    const handle = <UserContent translate="no">@{from.handle}</UserContent>;
    const name = <UserContent translate="no">{summary.name}</UserContent>;
    return (
      <span className="ps-3 text-sm text-ink-2" data-slot="template-provenance">
        {from.removed ? (
          <Trans>
            Copied from {handle}’s {name} on the hub, CC0. Removed from the hub since.
          </Trans>
        ) : (
          <Trans>
            Copied from {handle}’s {name} on the hub, CC0
          </Trans>
        )}
      </span>
    );
  }
  if (from.kind === 'file') {
    const day = formatDay(i18n, from.importedAt);
    return (
      <span className="ps-3 text-sm text-ink-2" data-slot="template-provenance">
        <Trans>Imported from a file on {day}</Trans>
      </span>
    );
  }
  const starter = starterName(i18n, `starters.${from.starterId}.name`);
  return (
    <span className="ps-3 text-sm text-ink-2" data-slot="template-provenance">
      <Trans>From the {starter} starter</Trans>
    </span>
  );
}

function FolderMenu({
  summary,
  folders,
  disabled,
}: {
  summary: TemplateSummary;
  folders: readonly TemplateFolder[];
  disabled: boolean;
}) {
  const { t } = useLingui();
  const commands = useLibraryCommands();
  const current = folders.find((folder) => folder.id === summary.folderId);
  const move = (value: string) => {
    const folder = folders.find((each) => each.id === value) ?? null;
    if ((folder?.id ?? null) === summary.folderId) return;
    const name = folder?.name ?? '';
    void commands.run({
      steps: [
        {
          name: TEMPLATE_COMMANDS.moveToFolder,
          payload: { projectId: null, templateIds: [summary.id], folderId: folder?.id ?? null },
        },
      ],
      done: folder ? (
        <Trans>
          Moved to <UserContent translate="no">{name}</UserContent>
        </Trans>
      ) : (
        t`Taken out of its folder`
      ),
      failed: t`Couldn’t move the template`,
    });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button size="sm" variant="ghost" loading={commands.pending}>
          <Folder aria-hidden />
          <span className="sr-only">{t`Folder:`}</span>
          {current ? <UserContent translate="no">{current.name}</UserContent> : t`Not in a folder`}
          <ChevronDown aria-hidden className="text-ink-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-52 overflow-y-auto">
        <DropdownMenuLabel>{t`Folder`}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={summary.folderId ?? NONE} onValueChange={(value) => move(value)}>
          <DropdownMenuRadioItem value={NONE}>{t`Not in a folder`}</DropdownMenuRadioItem>
          {folders.map((folder) => (
            <DropdownMenuRadioItem key={folder.id} value={folder.id}>
              <UserContent translate="no">{folder.name}</UserContent>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** P3-V14: a template's tags, folder, favourite, trend date and where it came from, on its page. */
export function TemplateLibraryFacts({ summary, readOnly }: TemplateLibraryFactsProps) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const commands = useLibraryCommands();
  const [tagging, setTagging] = useState(false);
  const folders = useRpcQuery(
    (signal) => backend.templates.folders(undefined, { signal }),
    [backend, summary.folderId],
  );
  const trend = summary.trendFreshness;
  const stale = trend !== null && isTrendStale(trend.date, Date.now());
  const days = i18n.number(STALE_AFTER_DAYS);

  const favourite = () =>
    void commands.run({
      steps: [
        {
          name: TEMPLATE_COMMANDS.setFavourite,
          payload: { projectId: null, templateId: summary.id, favourite: !summary.favourite },
        },
      ],
      done: summary.favourite ? t`Removed from Favourites` : t`Added to Favourites`,
      failed: t`Couldn’t change Favourites`,
    });

  return (
    <section
      aria-label={t`In your library`}
      data-slot="template-facts"
      className="-ms-3 flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={summary.favourite}
        disabled={readOnly}
        loading={commands.pending}
        onClick={favourite}
      >
        <Star aria-hidden className={cn(summary.favourite && 'fill-current text-ink')} />
        {t`Favourite`}
      </Button>
      <FolderMenu summary={summary} folders={folders.data ?? []} disabled={readOnly} />
      <span className="flex flex-wrap items-center gap-1.5">
        {summary.tags.map((tag) => (
          <Chip key={tag} translate="no">
            {tag}
          </Chip>
        ))}
        <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => setTagging(true)}>
          <Tag aria-hidden />
          {summary.tags.length > 0 ? t`Edit tags…` : t`Add tags…`}
        </Button>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 ps-3 text-sm text-ink-2">
        {trend ? (
          <span className="flex items-center gap-1.5">
            <CalendarClock aria-hidden className="size-4 text-ink-3" />
            {t`Trend date`}{' '}
            <time dateTime={trend.date} className="font-sans">
              {formatIsoDate(i18n, trend.date)}
            </time>
          </span>
        ) : null}
        {stale ? (
          <>
            <Chip tone="warning">
              <CircleAlert aria-hidden />
              {t`Trend may be stale`}
            </Chip>
            <span className="text-ink-2">{t`Over ${days} days old: the sound or style may have moved on.`}</span>
          </>
        ) : null}
        <TrendDateField summary={summary} disabled={readOnly} />
      </span>
      <Provenance summary={summary} />
      <TagDialog open={tagging} onOpenChange={setTagging} templates={[summary]} suggestions={[]} />
    </section>
  );
}
