// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: project list (UX4: the kit's ListRows) · system: DESIGN.md v0.6 + UX4
 * the Make list's states: the cause and Try again; the rows' bones (the ListRow's own shape, captured as
 *   `make-projects`); nothing listed (Archived: its EmptyState; every project archived: one line and the way to
 *   start another); every project as a ListRow in hover-pill ListRows, newest change first
 * states: loading (bones) · error (the cause and Try again; a failed refresh keeps the rows and says so above
 *   them) · empty · filled (rows arrive once) · selecting (every row shows its box)
 * motion: the rows arrive once (Arrival); nothing else
 */
import { useLingui } from '@lingui/react/macro';
import type { ProjectId, ProjectSummary } from '@taalcut/core';
import { Arrival, cn, CONCEPT_ICONS, EmptyState, ListRows, Skeleton } from '@taalcut/ui';
import type { Loadable } from '../../backend/use-rpc';
import { LoadError } from './load-error';
import { ArchivedEmpty } from './make-empty';
import { ProjectRow } from './project-row';
import type { useRecoveredProjects } from './use-recovered';

/** One row's shape (box, poster, name and facts, the cut, the date), for the bones and their capture. */
export function RowShape({ bone, lines = 3 }: { bone: boolean; lines?: 2 | 3 }) {
  const b = cn('block rounded-sm bg-hover', bone && 'tc-bone');
  return (
    <li aria-hidden className="flex items-center gap-4 px-3 py-2.5">
      <span className={cn(b, 'aspect-[9/16] w-10 shrink-0 rounded-md')} />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className={cn(b, 'h-4 w-48')} />
        <span className={cn(b, 'h-3 w-36')} />
        {lines === 3 ? <span className={cn(b, 'h-3 w-full rounded-clip')} /> : null}
      </span>
      <span className={cn(b, 'h-3 w-14 shrink-0')} />
      <span className="size-9 shrink-0" />
    </li>
  );
}

function RowShapes({ bone }: { bone: boolean }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {Array.from({ length: 4 }, (_, i) => (
        <RowShape key={i} bone={bone} />
      ))}
    </ul>
  );
}

export interface ProjectListProps {
  readonly list: Loadable<{ readonly items: readonly ProjectSummary[] }> & { readonly reload: () => void };
  /** Show the bones although the list is here (the page is still working out which empty state it is). */
  readonly holding?: boolean;
  readonly archived: boolean;
  readonly now: number;
  readonly recovered: ReturnType<typeof useRecoveredProjects>;
  /** Absent on the archived list: batch work is for current projects. */
  readonly selection?: {
    readonly selecting: boolean;
    readonly isSelected: (projectId: ProjectId) => boolean;
    readonly onSelect: (projectId: ProjectId, on: boolean) => void;
  };
}

/** The list's states: the cause and Try again, the rows' bones, nothing listed, or every project as a row. */
export function ProjectList({
  list,
  holding = false,
  archived,
  now,
  recovered,
  selection,
}: ProjectListProps) {
  const { t } = useLingui();
  const items = holding ? undefined : list.data?.items;
  const name = archived ? t`Archived projects` : t`Projects`;
  if (list.error && !items) return <LoadError error={list.error} onRetry={list.reload} />;
  if (items && items.length === 0)
    return archived ? (
      <ArchivedEmpty />
    ) : (
      <EmptyState
        variant="compact"
        tone="make"
        icon={CONCEPT_ICONS.archived}
        title={t`Every project is archived. Make a video to start another.`}
      />
    );
  return (
    <div className="flex flex-col gap-3">
      {/* A refresh that failed keeps the rows on screen and says so. */}
      {list.error && items ? <LoadError error={list.error} onRetry={list.reload} /> : null}
      <Skeleton
        name="make-projects"
        loading={!items}
        fixture={<RowShapes bone={false} />}
        fallback={<RowShapes bone />}
      >
        {items ? (
          <Arrival animate>
            <ListRows framed aria-label={name} data-slot="project-list">
              {items.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  recovered={recovered.get(project.id)}
                  now={now}
                  {...(selection
                    ? {
                        selecting: selection.selecting,
                        selected: selection.isSelected(project.id),
                        onSelect: (on: boolean) => selection.onSelect(project.id, on),
                      }
                    : {})}
                />
              ))}
            </ListRows>
          </Arrival>
        ) : (
          <span role="status" className="sr-only">
            {archived ? t`Loading archived projects` : t`Loading your projects`}
          </span>
        )}
      </Skeleton>
    </div>
  );
}
