// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · page: Make (/projects, P2-X3, UX1, UX4) · system: DESIGN.md v0.6 + UX4 (Page, kit)
 * the Make area's home on the page grid, standard width: the views (Projects, Exports, Archived, Your style) in
 *   Page's views slot with the count and Select beside them; Make a video in the bar's actions, the screen's one
 *   marigold fill; the first visit's tip (what the cut strip's edges mean); then every project as a ListRow, newest
 *   change first, its cut drawn on the time axis
 * states: loading (row bones, the count's place kept) · empty (ProjectsEmpty, Kaatu beside it: nothing made and
 *   nothing archived) · filled · archived (its own view; nothing archived: ArchivedEmpty) · error (the cause, Try
 *   again; a failed refresh keeps the rows) · recovered (a line on each project the recovery report names) ·
 *   selecting (P3-V16: Select or a row's box; the bulk bar above the list; Done or Escape leaves)
 * motion: rows arrive once (Arrival); the bulk bar arrives once; the views' thumb glides (the kit's)
 */
import { Plural, useLingui } from '@lingui/react/macro';
import { Button, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { useRpcQuery } from '../../backend/use-rpc';
import { Page } from '../../shell/page';
import { PageTip } from '../kaatu/page-tip';
import { BulkBar } from '../projects/batch/bulk-bar';
import { ProjectsEmpty } from './make-empty';
import { MakeStudioLead } from './make-studio-lead';
import { MakeViews, ViewCount } from './make-views';
import { ProjectList } from './project-list';
import { useProjectSelection } from './project-selection';
import { useRecoveredProjects } from './use-recovered';

export function ProjectsPage({ archived = false, now = Date.now() }: { archived?: boolean; now?: number }) {
  const { t } = useLingui();
  const backend = useBackend();
  const selection = useProjectSelection();
  const recovered = useRecoveredProjects();
  const list = useRpcQuery(
    (signal) => backend.projects.list({ archived, limit: 200 }, { signal }),
    [backend, archived],
  );
  // The archived list, only to know that nothing at all has been made yet (the empty state).
  const shelved = useRpcQuery(
    async (signal) =>
      archived ? null : (await backend.projects.list({ archived: true, limit: 1 }, { signal })).items.length,
    [backend, archived],
  );
  // A change re-reads the same lists: reload() keeps the rows on screen while it does.
  useBackendEvents(['library.changed'], ({ payload }) => {
    if (payload.entity === 'project' || payload.entity === 'timeline' || payload.entity === 'render') {
      list.reload();
      shelved.reload();
    }
  });

  const items = list.data?.items;
  const empty = !archived && items?.length === 0 && shelved.data === 0;
  // Nothing current, and the archived count still on its way: keep the bones rather than guess which empty it is.
  const holding = !archived && items?.length === 0 && shelved.status === 'loading';
  // Batch work is for the current projects; a project that left the list leaves the selection.
  const picked = items?.filter((project) => selection.selected.has(project.id)) ?? [];
  const selecting = !archived && selection.selecting;
  const filled = !!items && items.length > 0 && !holding;

  const views = (
    <>
      <MakeViews current={archived ? 'archived' : 'projects'} />
      {empty || (archived && items?.length === 0) ? null : (
        <ViewCount>
          {items && !holding ? <Plural value={items.length} one="# project" other="# projects" /> : null}
        </ViewCount>
      )}
      {!archived && !selecting && filled ? (
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto"
          icon={VERB_ICONS.select}
          onClick={selection.start}
        >
          {t`Select`}
        </Button>
      ) : null}
    </>
  );
  // In the window bar; not over the empty state, whose own button is the screen's one primary.
  const actions = empty ? undefined : (
    <Button asChild size="sm" variant="primary" icon={VERB_ICONS.makeVideo}>
      <Link to="/chat">{t`Make a video`}</Link>
    </Button>
  );

  return (
    <Page
      title={t`Make`}
      width={archived ? 'standard' : 'wide'}
      {...(archived ? { detail: t`Archived` } : {})}
      views={views}
      {...(actions ? { actions } : {})}
    >
      {empty ? (
        <ProjectsEmpty />
      ) : (
        <section
          aria-label={archived ? t`Archived projects` : t`Projects`}
          className="flex flex-col gap-6"
          data-slot="projects"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && selecting && !event.defaultPrevented) selection.stop();
          }}
        >
          {!archived && filled ? (
            <PageTip id="make-projects">
              {t`Each row is a video’s cut, clip by clip, under its name. A violet edge is a shot Taalcut picked; teal is one you changed.`}
            </PageTip>
          ) : null}
          {!archived && filled && items ? <MakeStudioLead projects={items} /> : null}
          {selecting && items ? (
            <BulkBar
              projects={picked}
              total={items.length}
              onSelectAll={(on) => selection.setAll(on ? items.map((project) => project.id) : [])}
              onDone={selection.stop}
            />
          ) : null}
          <ProjectList
            list={list}
            holding={holding}
            archived={archived}
            now={now}
            recovered={recovered}
            {...(archived
              ? {}
              : {
                  selection: {
                    selecting,
                    isSelected: (projectId) => selection.selected.has(projectId),
                    onSelect: selection.select,
                  },
                })}
          />
        </section>
      )}
    </Page>
  );
}
