// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: project row (UX4: the kit's ListRow) · system: DESIGN.md v0.6 + UX4
 * one ListRow in ListRows (hover pills on the canvas): the newest cut's first frame on the viewer grey, 40 px wide
 *   like an export's (a project with no video yet: a dashed frame with the Make glyph, never a black tile); the
 *   name as written; the facts in one meta line (length, videos, exports, and the clips you picked in teal); the
 *   newest cut across the row's whole width, each block with who chose it on its lower edge (violet the AI, teal
 *   you); when it changed at the row's end; after a crash, one line saying the last change is here. The row opens
 *   the timeline; More (⋯) renames, exports or archives, each with Undo in the toast where it changes something.
 *   The box sits at the row's start, shown on hover and focus and while selecting (the kit's Checkbox)
 * states: the kit's ListRow (default · hover · focus · active · selected · selecting) · loading (frame and blocks
 *   wait as bones; name and facts show at once from the list) · error (the row still opens; the frame and blocks
 *   stay grey) · success (renamed or archived: the list changes and the toast says so, with Undo)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { PROJECT_COMMANDS, type ProjectSummary, type Timeline, type TimelineSummary } from '@taalcut/core';
import {
  Button,
  chosenBy,
  cn,
  CONCEPT_ICONS,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ListRow,
  placeVideo,
  toSeconds,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useId, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcQuery } from '../../backend/use-rpc';
import { commandLabel } from '../../recovery/labels';
import { useMediaUrls } from '../../services/provider';
import { formatDay, formatSeconds, formatTime } from '../shared/format';
import { MakePoster } from './make-poster';
import { RenameDialog } from './rename-dialog';
import type { Recovered } from './use-recovered';
import { useUndoable } from './use-undoable';

interface NewestCut {
  readonly summary: TimelineSummary | null;
  readonly timeline: Timeline | null;
}

function CutStrip({ timeline }: { timeline: Timeline }) {
  const { items } = placeVideo(timeline);
  return (
    <span
      aria-hidden
      className="mt-2 flex h-3.5 w-full items-center gap-0.5 rounded-sm bg-sunken p-0.5 ring-1 ring-rule-subtle"
      data-slot="project-cut"
    >
      {items.map((item) => {
        const by = item.kind === 'clip' ? chosenBy(timeline, item.clip.id) : null;
        return (
          <span
            key={item.kind === 'clip' ? item.clip.id : item.id}
            data-chosen-by={by ?? undefined}
            className={cn(
              'relative block h-full overflow-hidden rounded-clip',
              item.kind === 'gap'
                ? 'border border-dashed border-rule'
                : by === 'you'
                  ? 'bg-you-soft ring-1 ring-you-strong ring-inset'
                  : 'bg-ai-soft ring-1 ring-ai-strong ring-inset',
            )}
            style={{ flexGrow: item.frames, flexBasis: 0 }}
          >
            {by ? (
              <span
                className={cn(
                  'absolute inset-x-0 bottom-0 h-1',
                  by === 'you' ? 'bg-you-strong' : 'bg-ai-strong',
                )}
              />
            ) : null}
          </span>
        );
      })}
    </span>
  );
}

function RecoveredLine({ recovered }: { recovered: Recovered }) {
  const { i18n } = useLingui();
  const last = recovered.last;
  const what = last ? commandLabel(i18n, last.name) : null;
  const clock = last ? formatTime(i18n, last.at) : null;
  return (
    <span data-slot="project-recovered" className="mt-1.5 flex items-start gap-2 type-body text-ink">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info-strong" />
      <span>
        <Trans>Recovered after Taalcut closed unexpectedly.</Trans>{' '}
        {last && what ? (
          <Trans>
            Your last change is here: {what}, at{' '}
            <time dateTime={new Date(last.at).toISOString()} className="font-sans">
              {clock}
            </time>
            .
          </Trans>
        ) : (
          <Trans>Its work picks up where it left off.</Trans>
        )}
      </span>
    </span>
  );
}

export interface ProjectRowProps {
  project: ProjectSummary;
  recovered: Recovered | undefined;
  now: number;
  /** P3-V16: picked for the bulk bar; absent: the row has no checkbox (the archived list). */
  selected?: boolean;
  onSelect?: (on: boolean) => void;
  /** Selection mode: the box shows on every row, not only on hover and focus. */
  selecting?: boolean;
}

export function ProjectRow({
  project,
  recovered,
  now,
  selected,
  onSelect,
  selecting = false,
}: ProjectRowProps) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const media = useMediaUrls();
  const undoable = useUndoable();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const nameId = useId();
  const moreId = useId();
  const cut = useRpcQuery<NewestCut>(
    async (signal) => {
      const summaries = await backend.timelines.listByProject({ projectId: project.id }, { signal });
      const newest = [...summaries].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
      const timeline = newest ? await backend.timelines.get({ timelineId: newest.id }, { signal }) : null;
      return { summary: newest, timeline };
    },
    [backend, project.id, project.updatedAt],
  );
  const newest = cut.data?.summary ?? null;
  const timeline = cut.data?.timeline ?? null;
  const poster = project.poster ? media.derived(project.poster) : null;
  const yours = timeline
    ? placeVideo(timeline).items.filter(
        (item) => item.kind === 'clip' && chosenBy(timeline, item.clip.id) === 'you',
      ).length
    : 0;
  const archived = project.archivedAt !== null;
  const name = project.name;
  const length = newest ? formatSeconds(i18n, toSeconds(newest.duration)) : null;
  const day = formatDay(i18n, project.updatedAt, now);

  const archive = () =>
    void undoable.run({
      name: archived ? PROJECT_COMMANDS.unarchive : PROJECT_COMMANDS.archive,
      payload: { projectId: project.id },
      projectId: project.id,
      done: archived ? (
        <Trans>
          Brought back <UserContent translate="no">{name}</UserContent>
        </Trans>
      ) : (
        <Trans>
          Archived <UserContent translate="no">{name}</UserContent>
        </Trans>
      ),
      failed: archived ? t`Couldn’t bring the project back` : t`Couldn’t archive the project`,
    });

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-labelledby={`${moreId} ${nameId}`}
          loading={undoable.pending}
          icon={VERB_ICONS.more}
        >
          <span id={moreId} className="sr-only">
            {t`More for`}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={() => setRenaming(true)}>
          <VERB_ICONS.rename aria-hidden />
          {t`Rename…`}
        </DropdownMenuItem>
        {newest && !archived ? (
          <DropdownMenuItem
            onSelect={() =>
              void navigate({
                to: '/projects/$projectId/timeline',
                params: { projectId: project.id },
                search: { timeline: newest.id, export: true },
              })
            }
          >
            <VERB_ICONS.export aria-hidden />
            {t`Export…`}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={archive}>
          {archived ? <VERB_ICONS.unarchive aria-hidden /> : <VERB_ICONS.archive aria-hidden />}
          {archived ? t`Bring back` : t`Archive`}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <ListRow
      data-slot="project-row"
      data-project-id={project.id}
      title={
        <UserContent id={nameId} translate="no">
          {name}
        </UserContent>
      }
      leading={
        <MakePoster
          url={poster}
          empty={project.timelines === 0}
          emptyIcon={CONCEPT_ICONS.project}
          loading={cut.status === 'loading' && !cut.data}
        />
      }
      meta={
        <span className="tabular-nums">
          {length ? `${length} · ` : null}
          {project.timelines === 0 ? (
            t`No video yet`
          ) : (
            <Plural value={project.timelines} one="# video" other="# videos" />
          )}
          {project.renders > 0 ? (
            <>
              {' · '}
              <Plural value={project.renders} one="# export" other="# exports" />
            </>
          ) : null}
          {yours > 0 ? (
            <>
              {' · '}
              <span className="font-medium text-you-strong">
                <Plural value={yours} one="# clip you picked" other="# clips you picked" />
              </span>
            </>
          ) : null}
        </span>
      }
      trailingMeta={
        <Trans>
          <span className="sr-only">Changed</span>{' '}
          <time dateTime={new Date(project.updatedAt).toISOString()} className="font-sans">
            {day}
          </time>
        </Trans>
      }
      action={
        <Link
          to="/projects/$projectId/timeline"
          params={{ projectId: project.id }}
          search={newest ? { timeline: newest.id } : {}}
        />
      }
      {...(onSelect
        ? {
            select: { checked: selected ?? false, onCheckedChange: onSelect },
            selecting,
            selected: !!selected,
          }
        : {})}
      actions={
        <>
          {menu}
          <RenameDialog
            open={renaming}
            onOpenChange={setRenaming}
            title={t`Rename the project`}
            label={t`Name`}
            value={name}
            maxLength={200}
            onSave={(next) =>
              undoable.run({
                name: PROJECT_COMMANDS.rename,
                payload: { projectId: project.id, name: next },
                projectId: project.id,
                done: (
                  <Trans>
                    Renamed to <UserContent translate="no">{next}</UserContent>
                  </Trans>
                ),
                failed: t`Couldn’t rename the project`,
              })
            }
          />
        </>
      }
    >
      {timeline ? (
        <CutStrip timeline={timeline} />
      ) : cut.status === 'loading' ? (
        <span aria-hidden className="tc-bone mt-1.5 block h-3 w-full rounded-clip bg-hover" />
      ) : null}
      {recovered ? <RecoveredLine recovered={recovered} /> : null}
    </ListRow>
  );
}
