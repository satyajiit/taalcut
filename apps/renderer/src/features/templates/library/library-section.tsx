// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: your templates' list (Your templates; UX4 tpl) · system: DESIGN.md v0.6 + UX4
 * the managed library, the page's one job: the places (folder-rail.tsx, links) left; search, one row of filters,
 *   the count and the sort over a windowed list; a bulk bar while some are selected; dropping files imports them.
 *   Every view is its URL (the place in the path, the rest in the search). Its name for screen readers is the
 *   place's ("All templates", "Travel"), an h2 the bar's title doesn't repeat visibly
 * states: loading (the "templates-list" skeleton: bones captured from the real rows) · filled · searching (LRN1-FIX:
 *   with words the list is templates.search's answer, best first, each row saying what matched; "Matching words
 *   only…" over it while search reads words only) · settling (the list answers older words or filters while the new
 *   answer loads: StaleContent, dimmed after 150 ms) · no matches (EmptyState compact: the search glyph, Clear
 *   filters) · an empty folder or no favourites (EmptyState compact with Kaatu: what puts templates there, and the
 *   way to All templates) · error (the cause, Try again) · selecting (bulk bar) · dragging files (drop panel) ·
 *   LRN1-STY: a folder's or one tag's view with templates has its set's style profile between the filters and the
 *   list, never over search results or an empty list
 * motion: rows arrive once (Arrival); the bulk bar rises in; the drop panel fades: three primitives
 */
import { useLingui } from '@lingui/react/macro';
import type { StyleSource, TemplateFolder, TemplateId, TemplateSummary } from '@taalcut/core';
import {
  AnimatePresence,
  Arrival,
  Button,
  CONCEPT_ICONS,
  DUR,
  EASE_OUT,
  EmptyState,
  ErrorLine,
  motion,
  REDUCED_FADE,
  Skeleton,
  StaleContent,
  TemplateSearchWordsOnly,
  useReducedMotion,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CAPTURE_SUMMARIES } from '../capture/template-fixtures';
import { StyleProfilePanel } from '../profiles/style-profile-panel';
import { ROW_HEIGHT } from '../template-row';
import { BulkBar } from './bulk-bar';
import { FolderRail } from './folder-rail';
import { ImportDropZone, useImportTemplates } from './import-drop';
import { LibraryToolbar } from './library-toolbar';
import { extend, NO_SELECTION, prune, selectAll, selectedIn, toggle, type Selection } from './selection';
import { TemplateList } from './template-list';
import { CLEARED, isTrendStale, type TemplateSearch } from './template-search';
import type { TemplateLibrary } from './use-template-library';
import { TEMPLATE_ICONS } from '../template-icons';

export interface LibrarySectionProps {
  readonly search: TemplateSearch;
  readonly onSearch: (next: Partial<TemplateSearch>, replace: boolean) => void;
  readonly library: TemplateLibrary;
  /** The field's words as typed, and whether any words or filter narrow the view. */
  readonly text: string;
  readonly onText: (text: string) => void;
  readonly filtered: boolean;
  /** The set this view shows whole (a folder, or one tag), whose style profile sits above the list; else null. */
  readonly styleSource: StyleSource | null;
  readonly now: number;
}

/** The generic stand-in until bones are captured: rows in the list's own shape. */
function RowBones() {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className="flex items-center gap-3 ps-1" style={{ height: ROW_HEIGHT }}>
          <span className="size-8" />
          <span className="tc-bone block h-16 w-9 rounded-md bg-hover" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="tc-bone block h-4 w-48 rounded-sm bg-hover" />
            <span className="tc-bone block h-2 w-full max-w-sm rounded-sm bg-hover" />
          </span>
        </span>
      ))}
    </div>
  );
}

/** Which templates are picked, kept to the ones still listed, and the list's ways of changing that. */
function useLibrarySelection(order: readonly TemplateId[]) {
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  useEffect(() => setSelection((prev) => prune(prev, order)), [order]);
  const onSelect = useCallback(
    (next: { kind: 'toggle' | 'extend'; id: TemplateId } | { kind: 'all' | 'none' }) =>
      setSelection((prev) => {
        if (next.kind === 'toggle') return toggle(prev, next.id);
        if (next.kind === 'extend') return extend(prev, order, next.id);
        return next.kind === 'all' ? selectAll(order) : NO_SELECTION;
      }),
    [order],
  );
  const clear = useCallback(() => setSelection(NO_SELECTION), []);
  return { selection, onSelect, clear };
}

/** The list's name for screen readers: the folder or view it shows. */
function useViewLabel(folder: TemplateSearch['folder'], folders: readonly TemplateFolder[] | undefined) {
  const { t } = useLingui();
  if (folder === 'favourites') return t`Favourites`;
  if (folder === 'unfiled') return t`Not in a folder`;
  if (!folder) return t`All templates`;
  return folders?.find((each) => each.id === folder)?.name ?? t`Folder`;
}

/** Nothing listed: no matches (Clear filters), or an empty folder or no favourites (what puts templates there). */
function NothingListed(props: { filtered: boolean; folder: TemplateSearch['folder']; onClear: () => void }) {
  const { t } = useLingui();
  if (props.filtered)
    return (
      <EmptyState
        variant="compact"
        icon={CONCEPT_ICONS.search}
        title={t`No templates match.`}
        description={t`Try other words or fewer filters.`}
        action={
          <Button size="sm" variant="ghost" icon={VERB_ICONS.clearFilters} onClick={props.onClear}>
            {t`Clear filters`}
          </Button>
        }
      />
    );
  return (
    <EmptyState
      variant="compact"
      kaatu
      title={props.folder === 'favourites' ? t`No favourites yet.` : t`Nothing in this folder yet.`}
      description={
        props.folder === 'favourites'
          ? t`In All templates, tick the ones you use most, then press Favourite.`
          : t`In All templates, tick the ones that belong here, then choose Move to….`
      }
      action={
        <Button asChild size="sm" variant="ghost" icon={TEMPLATE_ICONS.all}>
          <Link to="/templates">{t`All templates`}</Link>
        </Button>
      }
    />
  );
}

/** The bulk bar rises in while some templates are picked. */
function RisingBulkBar({ show, children }: { readonly show: boolean; readonly children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="bulk"
          className="sticky bottom-4 z-10"
          initial={{ opacity: 0, y: reduced ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : 8 }}
          transition={{ duration: reduced ? REDUCED_FADE : DUR.short, ease: EASE_OUT }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

const noop = () => undefined;
const never = () => false;
const NO_FOLDERS: ReadonlyMap<string, string> = new Map();

export function LibrarySection({
  search,
  onSearch,
  library,
  text,
  onText,
  filtered,
  styleSource,
  now,
}: LibrarySectionProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const imports = useImportTemplates();
  const { list, settling, failed, facets, folders } = library;
  const items = list.data?.items;
  const matches = list.data?.matches ?? null;
  const order = useMemo(() => (items ?? []).map((item) => item.id), [items]);
  const { selection, onSelect, clear } = useLibrarySelection(order);
  const view = useViewLabel(search.folder, folders.data);
  const isStale = useCallback(
    (summary: TemplateSummary) =>
      summary.trendFreshness !== null && isTrendStale(summary.trendFreshness.date, now),
    [now],
  );
  const folderNames = useMemo(
    () =>
      new Map((folders.data ?? []).filter((f) => f.id !== search.folder).map((f) => [f.id, f.name] as const)),
    [folders.data, search.folder],
  );
  const onOpen = useCallback(
    (templateId: TemplateId) => void navigate({ to: '/templates/$templateId', params: { templateId } }),
    [navigate],
  );
  const change = (next: Partial<TemplateSearch>) => {
    if ('q' in next) onText(next.q ?? '');
    onSearch(next, true);
  };
  const selected = (items ?? []).filter((item) => selection.ids.has(item.id));

  const toFolder = (place: TemplateSearch['folder']) =>
    void (place
      ? navigate({ to: '/templates/folders/$folderId', params: { folderId: place }, search: true })
      : navigate({ to: '/templates', search: true }));

  const results = failed ? (
    <div className="flex flex-col items-start gap-3">
      <ErrorLine error={failed} />
      <Button size="sm" icon={VERB_ICONS.retry} onClick={list.reload}>
        {t`Try again`}
      </Button>
    </div>
  ) : items?.length === 0 ? (
    <NothingListed filtered={filtered} folder={search.folder} onClear={() => change(CLEARED)} />
  ) : (
    <div aria-busy={!items || undefined}>
      {items ? null : (
        <span role="status" className="sr-only">
          {t`Loading your templates`}
        </span>
      )}
      <Skeleton
        name="templates-list"
        loading={!items}
        fallback={<RowBones />}
        fixture={
          <TemplateList
            items={CAPTURE_SUMMARIES}
            selection={NO_SELECTION}
            onSelect={noop}
            onOpen={noop}
            folderNames={NO_FOLDERS}
            isStale={never}
            now={now}
            label={view}
            answers=""
          />
        }
      >
        {items ? (
          <StaleContent stale={settling}>
            <Arrival animate>
              <TemplateList
                items={items}
                selection={selection}
                onSelect={onSelect}
                onOpen={onOpen}
                folderNames={folderNames}
                isStale={isStale}
                now={now}
                label={view}
                answers={list.data?.words ?? ''}
                matches={matches?.byId}
              />
            </Arrival>
          </StaleContent>
        ) : null}
      </Skeleton>
    </div>
  );

  return (
    <ImportDropZone onFiles={(files) => void imports.importFiles(files)}>
      <section aria-labelledby="templates-mine" className="flex flex-col gap-5" data-slot="templates">
        <h2 id="templates-mine" className="sr-only">
          {/* A folder of the person's own is named as they wrote it, not offered for translation. */}
          {!search.folder ? (
            t`Your templates`
          ) : search.folder === 'favourites' || search.folder === 'unfiled' ? (
            view
          ) : (
            <UserContent translate="no">{view}</UserContent>
          )}
        </h2>
        {/* The folder rail takes what its rows need, up to 12rem, so the filters keep one line at 1280 on the page
            grid's column (UX4 shell: the column starts under the bar's title). */}
        <div className="grid grid-cols-[fit-content(12rem)_minmax(0,1fr)] items-start gap-6">
          <div className="sticky top-4">
            <FolderRail folder={search.folder} onFolder={toFolder} folders={folders} total={facets?.total} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <LibraryToolbar
              search={search}
              onChange={change}
              text={text}
              onText={onText}
              facets={facets}
              count={items?.length}
            />
            {/* The answer on screen reads words only (no Search model yet): the panel's line, over the list too. */}
            {matches?.degraded === 'keyword-only' ? <TemplateSearchWordsOnly /> : null}
            {styleSource ? <StyleProfilePanel source={styleSource} level={3} hideWhenEmpty /> : null}
            {results}
            <RisingBulkBar show={selectedIn(selection, order).length > 0}>
              <BulkBar
                selected={selected}
                folders={folders.data ?? []}
                tagSuggestions={facets?.tags ?? []}
                onClear={clear}
              />
            </RisingBulkBar>
          </div>
        </div>
      </section>
    </ImportDropZone>
  );
}
