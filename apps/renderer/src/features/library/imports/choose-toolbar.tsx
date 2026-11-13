// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Trans, useLingui } from '@lingui/react/macro';
import { Button, Checkbox, Input, cn } from '@taalcut/ui';
import { Camera, Check, Film, Folder, FolderOpen, Image, X } from 'lucide-react';
import {
  ROOT_DIRECTORY_KEY,
  type CatalogSummary,
  type DirectoryGroup,
  type MediaKindFilter,
} from './import-item-meta';
import { bytes } from './import-words';

function DirectoryIcon({ label, active }: { label: string | null; active?: boolean }) {
  const lower = label?.toLowerCase() ?? '';
  if (lower === 'camera' || lower === 'dcim' || lower.includes('dji') || lower === 'expert raw') {
    return <Camera aria-hidden className="size-3.5 shrink-0" />;
  }
  if (lower === 'movies' || lower.includes('recording') || lower.includes('video')) {
    return <Film aria-hidden className="size-3.5 shrink-0" />;
  }
  if (lower === 'pictures' || lower === 'screenshots') {
    return <Image aria-hidden className="size-3.5 shrink-0" />;
  }
  const Icon = active ? FolderOpen : Folder;
  return <Icon aria-hidden className="size-3.5 shrink-0" />;
}

export function ChooseToolbar({
  query,
  onQueryChange,
  onlyNew,
  onOnlyNewChange,
  mediaFilter,
  onMediaFilterChange,
  directories,
  activeDirectory,
  onDirectoryChange,
  summary,
  visibleTotal,
  visibleVideos,
  visibleImages,
  allVisibleSelected,
  pending,
  loadingCatalog,
  totalCatalogCount,
  onSelectAllFootage,
  onClearSelection,
  onSelectAllVideos,
  onToggleVisible,
  onToggleDirectory,
  onSelectDirectoryVideos,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onlyNew: boolean;
  onOnlyNewChange: (value: boolean) => void;
  mediaFilter: MediaKindFilter;
  onMediaFilterChange: (value: MediaKindFilter) => void;
  directories: readonly DirectoryGroup[];
  activeDirectory: string | null;
  onDirectoryChange: (key: string | null) => void;
  summary: CatalogSummary;
  visibleTotal: number;
  visibleVideos: number;
  visibleImages: number;
  allVisibleSelected: boolean;
  pending: boolean;
  loadingCatalog: boolean;
  totalCatalogCount: number;
  onSelectAllFootage: () => void;
  onClearSelection: () => void;
  onSelectAllVideos: () => void;
  onToggleVisible: () => void;
  onToggleDirectory: (key: string) => void;
  onSelectDirectoryVideos: (key: string) => void;
}) {
  const { t, i18n } = useLingui();
  const number = (value: number) => new Intl.NumberFormat(i18n.locale).format(value);
  const activeGroup = activeDirectory
    ? directories.find((group) => group.key === activeDirectory) ?? null
    : null;
  const folderName = (label: string | null) => label ?? t`Camera & originals`;
  const hasNamedFolders =
    directories.length > 1 || (directories.length === 1 && directories[0]?.key !== ROOT_DIRECTORY_KEY);
  const activeFolderAllSelected =
    activeGroup !== null && activeGroup.selectable > 0 && activeGroup.selected >= activeGroup.selectable;
  const activeVideoCount = activeGroup ? number(activeGroup.videos) : '0';
  const activeImageCount = activeGroup ? number(activeGroup.images) : '0';
  const matchingCount = number(visibleTotal);
  const visibleVideoCount = number(visibleVideos);
  const visibleImageCount = number(visibleImages);
  const loadedCount = number(summary.total);
  const catalogCount = number(totalCatalogCount);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-rule-subtle bg-well p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label={t`Filter by media type`}
          className="inline-flex items-center gap-0.5 rounded-lg border border-rule-subtle bg-sunken p-0.5"
        >
          <button
            type="button"
            aria-pressed={mediaFilter === 'all'}
            onClick={() => onMediaFilterChange('all')}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 type-label-sm transition-colors duration-(--dur-micro) focus-visible:outline-2 focus-visible:outline-focus',
              mediaFilter === 'all' ? 'bg-raised text-ink shadow-xs' : 'text-ink-2 hover:text-ink',
            )}
          >
            <span>{t`All`}</span>
            <span className="rounded-pill bg-chip px-1.5 py-0.25 type-caption text-ink-2 tabular-nums">
              {number(summary.total)}
            </span>
          </button>
          <button
            type="button"
            aria-pressed={mediaFilter === 'video'}
            onClick={() => onMediaFilterChange('video')}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 type-label-sm transition-colors duration-(--dur-micro) focus-visible:outline-2 focus-visible:outline-focus',
              mediaFilter === 'video' ? 'bg-raised text-ink shadow-xs' : 'text-ink-2 hover:text-ink',
            )}
          >
            <Film aria-hidden className="size-3.5" />
            <span>{t`Videos`}</span>
            <span className="rounded-pill bg-chip px-1.5 py-0.25 type-caption text-ink-2 tabular-nums">
              {number(summary.videos)}
            </span>
          </button>
          <button
            type="button"
            aria-pressed={mediaFilter === 'image'}
            onClick={() => onMediaFilterChange('image')}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 type-label-sm transition-colors duration-(--dur-micro) focus-visible:outline-2 focus-visible:outline-focus',
              mediaFilter === 'image' ? 'bg-raised text-ink shadow-xs' : 'text-ink-2 hover:text-ink',
            )}
          >
            <Image aria-hidden className="size-3.5" />
            <span>{t`Photos`}</span>
            <span className="rounded-pill bg-chip px-1.5 py-0.25 type-caption text-ink-2 tabular-nums">
              {number(summary.images)}
            </span>
          </button>
        </div>

        <div className="relative min-w-44 flex-1">
          <Input
            aria-label={t`Filter filenames`}
            placeholder={t`Filter filenames or folders…`}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="h-8 w-full pr-7"
          />
          {query ? (
            <button
              type="button"
              aria-label={t`Clear filter`}
              onClick={() => onQueryChange('')}
              className="absolute inset-y-0 right-1.5 my-auto flex size-5 items-center justify-center rounded-sm text-ink-2 hover:bg-hover hover:text-ink"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          ) : null}
        </div>

        <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-rule-subtle bg-canvas px-2.5 type-label-sm">
          <Checkbox
            checked={onlyNew}
            disabled={pending}
            onCheckedChange={(value) => onOnlyNewChange(value === true)}
          />
          {t`Only new`}
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          {summary.videos > 0 && summary.images > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={onSelectAllVideos}
            >{t`Select all videos`}</Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={onSelectAllFootage}
          >{t`Select all footage`}</Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={onClearSelection}
          >{t`Clear selection`}</Button>
        </div>
      </div>

      {hasNamedFolders ? (
        <div className="flex flex-col gap-2 border-t border-rule-subtle pt-2">
          <div
            role="group"
            aria-label={t`Folders`}
            className="scrollbar-thin flex items-center gap-1.5 overflow-x-auto pb-0.5"
          >
            <button
              type="button"
              aria-pressed={activeDirectory === null}
              onClick={() => onDirectoryChange(null)}
              className={cn(
                'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 type-label-sm transition-colors duration-(--dur-micro) focus-visible:outline-2 focus-visible:outline-focus',
                activeDirectory === null
                  ? 'border-rule-strong bg-raised text-ink shadow-xs'
                  : 'border-rule-subtle bg-canvas text-ink-2 hover:bg-hover hover:text-ink',
              )}
            >
              <FolderOpen aria-hidden className="size-3.5 shrink-0" />
              <span>{t`All folders`}</span>
              <span className="rounded-pill bg-chip px-1.5 py-0.25 type-caption text-ink-2 tabular-nums">
                {number(directories.length)}
              </span>
            </button>
            {directories.map((group) => {
              const active = activeDirectory === group.key;
              const hasPicked = group.selected > 0;
              return (
                <button
                  key={group.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onDirectoryChange(active ? null : group.key)}
                  className={cn(
                    'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 type-label-sm transition-colors duration-(--dur-micro) focus-visible:outline-2 focus-visible:outline-focus',
                    active
                      ? 'border-rule-strong bg-raised text-ink shadow-xs'
                      : hasPicked
                        ? 'border-rule-strong bg-selected text-ink'
                        : 'border-rule-subtle bg-canvas text-ink-2 hover:bg-hover hover:text-ink',
                  )}
                >
                  <DirectoryIcon label={group.label} active={active} />
                  <span className="max-w-36 truncate" translate={group.label ? 'no' : undefined}>
                    {folderName(group.label)}
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-pill px-1.5 py-0.25 type-caption tabular-nums',
                      hasPicked ? 'bg-inverse text-on-inverse' : 'bg-chip text-ink-2',
                    )}
                  >
                    {hasPicked ? <Check aria-hidden className="size-2.5" /> : null}
                    {hasPicked
                      ? `${number(group.selected)}/${number(group.total)}`
                      : number(group.total)}
                  </span>
                </button>
              );
            })}
          </div>

          {activeGroup ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rule-subtle bg-canvas px-3 py-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2 type-meta text-ink-2 tabular-nums">
                <span className="inline-flex items-center gap-1.5 type-label-sm text-ink">
                  <DirectoryIcon label={activeGroup.label} active />
                  <span translate={activeGroup.label ? 'no' : undefined}>
                    {folderName(activeGroup.label)}
                  </span>
                </span>
                <span aria-hidden>·</span>
                <span>
                  <Trans>{activeVideoCount} videos</Trans>
                </span>
                <span aria-hidden>·</span>
                <span>
                  <Trans>{activeImageCount} photos</Trans>
                </span>
                {activeGroup.sizeBytes > 0 ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{bytes(activeGroup.sizeBytes, i18n.locale)}</span>
                  </>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {activeGroup.videos > 0 && activeGroup.images > 0 ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => onSelectDirectoryVideos(activeGroup.key)}
                  >{t`Select folder videos`}</Button>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending || activeGroup.selectable === 0}
                  onClick={() => onToggleDirectory(activeGroup.key)}
                >
                  {activeFolderAllSelected ? t`Deselect folder` : t`Select folder`}
                </Button>
              </div>
            </div>
          ) : mediaFilter !== 'all' || query.trim().length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rule-subtle bg-canvas px-3 py-1.5">
              <div className="flex flex-wrap items-center gap-2 type-meta text-ink-2 tabular-nums">
                <span className="type-label-sm text-ink">
                  <Trans>{matchingCount} matching files</Trans>
                </span>
                <span aria-hidden>·</span>
                <span>
                  <Trans>{visibleVideoCount} videos</Trans>
                </span>
                <span aria-hidden>·</span>
                <span>
                  <Trans>{visibleImageCount} photos</Trans>
                </span>
              </div>
              {visibleTotal > 0 ? (
                <Button size="sm" variant="secondary" disabled={pending} onClick={onToggleVisible}>
                  {allVisibleSelected ? t`Deselect shown` : t`Select shown`}
                </Button>
              ) : null}
            </div>
          ) : loadingCatalog ? (
            <p className="m-0 px-1 type-caption text-ink-2 tabular-nums">
              <Trans>
                Organizing folders… {loadedCount} of {catalogCount} loaded
              </Trans>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
