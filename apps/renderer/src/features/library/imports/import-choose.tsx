// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ImportError } from './import-error';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  callRpc,
  type ImportDraftId,
  type ImportItem,
  type ImportMethod,
  type Result,
  type TaalcutError,
} from '@taalcut/core';
import { Button } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useRpcQuery } from '../../../backend/use-rpc';
import { ChooseItems } from './choose-items';
import { ChooseToolbar } from './choose-toolbar';
import { DraftFrame, ImportLoading, useDraft } from './draft-state';
import {
  applyBatchSelection,
  describeImportItem,
  directoryKeyOf,
  groupImportDirectories,
  summariseImportCatalog,
  type MediaKindFilter,
} from './import-item-meta';
import { bytes } from './import-words';
import { itemSelected } from './selection-model';

const AUTO_CATALOG_LIMIT = 5000;

export function ImportSelection({
  draftId,
  method,
  onReview,
}: {
  draftId: ImportDraftId;
  method: ImportMethod;
  onReview?: () => void;
}) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();
  const draft = useDraft(draftId);
  const [query, setQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState<MediaKindFilter>('all');
  const [activeDirectory, setActiveDirectory] = useState<string | null>(null);
  const [more, setMore] = useState<ImportItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<TaalcutError | null>(null);
  const onlyNew = draft.data?.onlyNew ?? true;
  const first = useRpcQuery(
    (signal) => backend.imports.items({ draftId, query, onlyNew, limit: 200 }, { signal }),
    [backend, draftId, query, onlyNew],
  );
  const summary = useRpcQuery(
    (signal) => backend.imports.preflight({ draftId }, { signal }),
    [backend, draftId, draft.data?.updatedAt],
  );
  useEffect(() => {
    setMore([]);
    setCursor(first.data?.nextCursor);
    setLoadError(null);
  }, [first.data]);

  useEffect(() => {
    const startCursor = first.data?.nextCursor;
    const total = first.data?.total ?? 0;
    if (!startCursor || total <= 250) return;
    const controller = new AbortController();
    void (async () => {
      let next: string | undefined = startCursor;
      let loaded = first.data?.items.length ?? 0;
      const accumulated: ImportItem[] = [];
      setLoadingMore(true);
      try {
        while (next && loaded < AUTO_CATALOG_LIMIT && !controller.signal.aborted) {
          const page: Result<{ items: ImportItem[]; total: number; nextCursor?: string }> = await callRpc(
            backend.imports.items(
              { draftId, query, onlyNew, cursor: next, limit: 200 },
              { signal: controller.signal },
            ),
          );
          if (controller.signal.aborted) return;
          if (!page.ok) {
            if (accumulated.length) setMore(accumulated);
            setCursor(next);
            setLoadError(page.error);
            return;
          }
          accumulated.push(...page.value.items);
          loaded += page.value.items.length;
          next = page.value.nextCursor;
        }
        if (!controller.signal.aborted) {
          setMore(accumulated);
          setCursor(next);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingMore(false);
      }
    })();
    return () => controller.abort();
  }, [backend, draftId, query, onlyNew, first.data]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    const result = await callRpc(backend.imports.items({ draftId, query, onlyNew, cursor, limit: 200 }));
    if (result.ok) {
      setMore((items) => [...items, ...result.value.items]);
      setCursor(result.value.nextCursor);
    } else setLoadError(result.error);
    setLoadingMore(false);
  };

  const data = draft.data;
  const allItems = useMemo(() => [...(first.data?.items ?? []), ...more], [first.data?.items, more]);
  const directories = useMemo(
    () => (data ? groupImportDirectories(allItems, data) : []),
    [allItems, data],
  );
  const catalogSummary = useMemo(
    () =>
      data
        ? summariseImportCatalog(allItems, data)
        : {
            total: 0,
            videos: 0,
            images: 0,
            selectedTotal: 0,
            selectedVideos: 0,
            selectedImages: 0,
            selectedDirectories: 0,
            selectedBytes: 0,
          },
    [allItems, data],
  );
  const effectiveDirectory = useMemo(
    () =>
      activeDirectory && directories.some((group) => group.key === activeDirectory)
        ? activeDirectory
        : null,
    [activeDirectory, directories],
  );
  const visibleItems = useMemo(
    () =>
      allItems.filter((item) => {
        const meta = describeImportItem(item);
        if (effectiveDirectory && directoryKeyOf(meta) !== effectiveDirectory) return false;
        if (mediaFilter !== 'all' && meta.kind !== mediaFilter) return false;
        return true;
      }),
    [allItems, effectiveDirectory, mediaFilter],
  );
  const visibleStats = useMemo(() => {
    let videos = 0;
    let images = 0;
    let selectable = 0;
    let selected = 0;
    for (const item of visibleItems) {
      const meta = describeImportItem(item);
      if (meta.kind === 'video') videos += 1;
      else images += 1;
      if (data && (!data.onlyNew || !item.duplicate)) selectable += 1;
      if (data && itemSelected(data, item)) selected += 1;
    }
    return {
      videos,
      images,
      allSelected: selectable > 0 && selected >= selectable,
    };
  }, [visibleItems, data]);

  if (!data) return <ImportLoading />;
  const number = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
  const selectedCount = summary.data?.selectedCaptures ?? catalogSummary.selectedTotal;
  const count = number(selectedCount);
  const knownBytes = summary.data?.knownBytes ?? catalogSummary.selectedBytes;

  const selectAllVideos = () => {
    const videos = allItems
      .filter((item) => describeImportItem(item).kind === 'video' && (!data.onlyNew || !item.duplicate))
      .map((item) => item.id);
    void draft.update({ selectAll: false, selectedIds: videos, excludedIds: [] });
  };
  const toggleDirectory = (dirKey: string) => {
    const folderItems = allItems.filter((item) => directoryKeyOf(describeImportItem(item)) === dirKey);
    const selectable = folderItems.filter((item) => !data.onlyNew || !item.duplicate);
    const allPicked = selectable.length > 0 && selectable.every((item) => itemSelected(data, item));
    void draft.update(applyBatchSelection(data, folderItems, !allPicked));
  };
  const selectDirectoryVideos = (dirKey: string) => {
    const folderVideos = allItems.filter((item) => {
      const meta = describeImportItem(item);
      return directoryKeyOf(meta) === dirKey && meta.kind === 'video';
    });
    void draft.update(applyBatchSelection(data, folderVideos, true));
  };
  const toggleVisible = () => {
    void draft.update(applyBatchSelection(data, visibleItems, !visibleStats.allSelected));
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18.5rem] xl:grid-cols-[minmax(0,1fr)_19.5rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <ChooseToolbar
          query={query}
          onQueryChange={setQuery}
          onlyNew={data.onlyNew}
          onOnlyNewChange={(value) => void draft.update({ onlyNew: value })}
          mediaFilter={mediaFilter}
          onMediaFilterChange={setMediaFilter}
          directories={directories}
          activeDirectory={effectiveDirectory}
          onDirectoryChange={setActiveDirectory}
          summary={catalogSummary}
          visibleTotal={visibleItems.length}
          visibleVideos={visibleStats.videos}
          visibleImages={visibleStats.images}
          allVisibleSelected={visibleStats.allSelected}
          pending={draft.pending}
          loadingCatalog={loadingMore}
          totalCatalogCount={first.data?.total ?? allItems.length}
          onSelectAllFootage={() =>
            void draft.update({ selectAll: true, selectedIds: [], excludedIds: [] })
          }
          onClearSelection={() =>
            void draft.update({ selectAll: false, selectedIds: [], excludedIds: [] })
          }
          onSelectAllVideos={selectAllVideos}
          onToggleVisible={toggleVisible}
          onToggleDirectory={toggleDirectory}
          onSelectDirectoryVideos={selectDirectoryVideos}
        />
        {first.error ? <ImportError error={first.error} onRetry={first.reload} /> : null}
        {loadError ? <ImportError error={loadError} onRetry={() => void loadMore()} /> : null}
        {first.status === 'loading' ? (
          <ImportLoading />
        ) : visibleItems.length ? (
          <ChooseItems draft={data} items={visibleItems} pending={draft.pending} update={draft.update} />
        ) : (
          <div className="flex flex-col items-start gap-2.5 rounded-xl border border-rule-subtle bg-well px-4 py-6">
            <p className="m-0 type-body text-ink-2">
              {t`No footage matches. Change the filter or turn off Only new.`}
            </p>
            {mediaFilter !== 'all' || effectiveDirectory !== null || query ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setMediaFilter('all');
                  setActiveDirectory(null);
                  setQuery('');
                }}
              >{t`Show all footage`}</Button>
            ) : null}
          </div>
        )}
        {cursor && !loadingMore ? (
          <Button
            variant="secondary"
            loading={loadingMore}
            onClick={() => void loadMore()}
          >{t`Load more footage`}</Button>
        ) : null}
      </div>
      <aside
        className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-xl border border-rule-subtle bg-panel p-3.5 lg:top-4 lg:flex-col lg:items-stretch lg:gap-3.5 lg:p-4"
        aria-label={t`Selection summary`}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {data.sourceLabel ? (
            <p className="m-0 truncate type-meta text-ink-2" translate="no" title={data.sourceLabel}>
              {data.sourceLabel}
            </p>
          ) : null}
          <div className="flex items-baseline justify-between gap-2">
            <p role="status" className="m-0 type-card-title tabular-nums">
              <Trans>{count} selected</Trans>
            </p>
            {knownBytes > 0 ? (
              <span className="type-meta font-medium text-ink tabular-nums">
                {bytes(knownBytes, i18n.locale)}
              </span>
            ) : null}
          </div>
        </div>
        <dl className="m-0 hidden grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 rounded-lg border border-rule-subtle bg-well p-3 type-meta lg:grid">
          <dt className="text-ink-2">{t`Videos`}</dt>
          <dd className="m-0 font-medium text-ink tabular-nums">
            {number(catalogSummary.selectedVideos)} / {number(catalogSummary.videos)}
          </dd>
          <dt className="text-ink-2">{t`Photos`}</dt>
          <dd className="m-0 font-medium text-ink tabular-nums">
            {number(catalogSummary.selectedImages)} / {number(catalogSummary.images)}
          </dd>
          <dt className="text-ink-2">{t`Folders`}</dt>
          <dd className="m-0 font-medium text-ink tabular-nums">
            {number(catalogSummary.selectedDirectories)} / {number(directories.length)}
          </dd>
        </dl>
        <p className="m-0 hidden type-meta text-ink-2 lg:block">
          <Trans>
            Required companions are kept with their capture. Review size, duplicates and destination before
            importing.
          </Trans>
        </p>
        {draft.writeError ? <ImportError error={draft.writeError} /> : null}
        {summary.error ? <ImportError error={summary.error} onRetry={summary.reload} /> : null}
        <Button
          variant="primary"
          data-action="review-import"
          disabled={draft.pending || !summary.data?.selectedItems}
          onClick={() =>
            onReview
              ? onReview()
              : void navigate({
                  to: '/library/import/$method/$draftId/review',
                  params: { method, draftId },
                })
          }
        >
          {t`Review import`}
        </Button>
      </aside>
    </div>
  );
}
export function ImportChoose({ method, draftId }: { method: ImportMethod; draftId: ImportDraftId }) {
  const { t } = useLingui();
  return (
    <DraftFrame method={method} draftId={draftId} step={t`Choose footage`}>
      {() => <ImportSelection method={method} draftId={draftId} />}
    </DraftFrame>
  );
}
