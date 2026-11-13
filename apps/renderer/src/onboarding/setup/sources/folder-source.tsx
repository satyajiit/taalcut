// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: onboarding, a folder on this Mac · genre: atmospheric studio app · system: DESIGN.md v0.4
 * the drop zone (the Library's own pattern) with Choose a folder… (main's dialog, then library.addSource); the
 *   folders added so far as hairline rows
 * states: drop zone default · drag-over (marigold rule, selected wash) · adding (the button spins) · added (the row,
 *   announced) · cancelled dialog (nothing) · failed (the cause under the zone) · not a folder (the line says so)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { SourceView } from '@taalcut/core';
import { Button, ErrorLine, UserContent, cn, useHostPlatform } from '@taalcut/ui';
import { Folder } from 'lucide-react';
import { useId, useState, type DragEvent } from 'react';
import { useAddFolder } from '../../../features/library/use-add-folder';

/** Folders added so far: the step reads them too (a source added enables Continue). */
export function folderSources(sources: readonly SourceView[]): SourceView[] {
  return sources.filter((source) => source.kind === 'watched_folder');
}

export function FolderSource({ folders, onAdded }: { folders: readonly SourceView[]; onAdded: () => void }) {
  const { t } = useLingui();
  const mac = useHostPlatform() === 'mac';
  const folder = useAddFolder(onAdded);
  const dropTitle = useId();
  const [dragging, setDragging] = useState(false);

  const over = (event: DragEvent) => {
    // Without this the browser opens a dropped file in the window.
    event.preventDefault();
    setDragging(true);
  };
  const leave = (event: DragEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void folder.drop(event.dataTransfer.files[0]);
  };

  return (
    <section
      aria-labelledby={dropTitle}
      data-slot="drop-zone"
      data-dragging={dragging || undefined}
      onDragEnter={over}
      onDragOver={over}
      onDragLeave={leave}
      onDrop={drop}
      className={cn(
        'flex flex-col items-start gap-4 rounded-2xl p-6',
        'border-2 border-dashed border-rule-strong',
        'transition-colors duration-(--dur-micro) ease-(--ease-out)',
        'data-[dragging]:border-primary-strong data-[dragging]:bg-selected',
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 id={dropTitle} className="m-0 text-lg font-semibold">
          <Trans>Drop a folder of videos here</Trans>
        </h2>
        <p className="m-0 max-w-[48ch] text-base text-ink-2">
          {mac ? (
            <Trans>Taalcut reads every clip where it is, on this Mac. Nothing is uploaded or moved.</Trans>
          ) : (
            <Trans>
              Taalcut reads every clip where it is, on this computer. Nothing is uploaded or moved.
            </Trans>
          )}
        </p>
      </div>
      <Button
        variant="secondary"
        data-action="pick-folder"
        loading={folder.busy}
        onClick={() => void folder.choose()}
      >
        <Trans>Choose a folder…</Trans>
      </Button>
      {folders.length > 0 ? (
        <ul aria-label={t`Folders added`} className="m-0 flex w-full list-none flex-col p-0">
          {folders.map((source) => (
            <li
              key={source.id}
              className="flex items-center gap-3 border-t border-rule-subtle py-2 text-sm first:border-t-0"
            >
              <Folder aria-hidden className="size-4 shrink-0 text-ink-3" />
              <UserContent translate="no" className="min-w-0 flex-1 truncate font-medium text-ink">
                {source.name}
              </UserContent>
            </li>
          ))}
        </ul>
      ) : null}
      <p role="status" className="m-0 min-h-[1lh] text-sm text-ink-2">
        {folder.note ?? (folders.length > 0 ? t`Added. Taalcut starts on them at once.` : '')}
      </p>
      {folder.error ? <ErrorLine error={folder.error} onFix={folder.fix} /> : null}
    </section>
  );
}
