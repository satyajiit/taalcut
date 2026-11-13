// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: library bulk bar · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * while templates are selected, a raised hairline bar at the foot of the list: how many, then Tag…, Move to…,
 *   Favourite, Export, Archive and Clear selection; each change is a command with Undo in the toast
 * states: buttons default · hover · focus-visible (base ring) · active (pressed) · disabled (while one runs) ·
 *   loading (the running one's spinner) · error (toast with the cause) · success (toast with Undo); the bar arrives
 *   and leaves with a short fade and rise (opacity and transform; a fade with reduced motion)
 * pre-emit critique: P5 H5 E4 S5 R4 V4
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { callRpc, TEMPLATE_COMMANDS, type TemplateFolder, type TemplateSummary } from '@taalcut/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
  UserContent,
} from '@taalcut/ui';
import { Archive, Download, Folder, FolderInput, FolderX, Star, Tag, X } from 'lucide-react';
import { useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { libraryErrorText } from './library-words';
import { TagDialog } from './tag-dialog';
import { useLibraryCommands } from './use-library-commands';

export interface BulkBarProps {
  readonly selected: readonly TemplateSummary[];
  readonly folders: readonly TemplateFolder[];
  readonly tagSuggestions: readonly string[];
  readonly onClear: () => void;
}

type Busy = 'move' | 'favourite' | 'export' | 'archive' | null;

export function BulkBar({ selected, folders, tagSuggestions, onClear }: BulkBarProps) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const commands = useLibraryCommands();
  const [busy, setBusy] = useState<Busy>(null);
  const [tagging, setTagging] = useState(false);
  const count = selected.length;
  const allFavourite = selected.every((item) => item.favourite);
  const ids = selected.map((item) => item.id);

  const run = async (kind: Busy, work: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await work();
    } finally {
      setBusy(null);
    }
  };

  const move = (folder: TemplateFolder | null) => {
    const folderName = folder?.name ?? '';
    return run('move', () =>
      commands.run({
        steps: [
          {
            name: TEMPLATE_COMMANDS.moveToFolder,
            payload: { projectId: null, templateIds: ids, folderId: folder?.id ?? null },
          },
        ],
        done: folder ? (
          <Trans>
            Moved <Plural value={count} one="# template" other="# templates" /> to{' '}
            <UserContent translate="no">{folderName}</UserContent>
          </Trans>
        ) : (
          <Plural
            value={count}
            one="Took # template out of its folder"
            other="Took # templates out of their folders"
          />
        ),
        failed: t`Couldn’t move the templates`,
      }),
    );
  };

  const favourite = () =>
    run('favourite', () => {
      const changing = selected.filter((item) => item.favourite === allFavourite);
      return commands.run({
        steps: changing.map((item) => ({
          name: TEMPLATE_COMMANDS.setFavourite,
          payload: { projectId: null, templateId: item.id, favourite: !allFavourite },
        })),
        done: allFavourite ? (
          <Plural value={changing.length} one="Removed # from Favourites" other="Removed # from Favourites" />
        ) : (
          <Plural value={changing.length} one="Added # to Favourites" other="Added # to Favourites" />
        ),
        failed: t`Couldn’t change Favourites`,
      });
    });

  const archive = () =>
    run('archive', () =>
      commands.run({
        steps: ids.map((templateId) => ({
          name: TEMPLATE_COMMANDS.archive,
          payload: { projectId: null, templateId, archived: true },
        })),
        done: <Plural value={count} one="Archived # template" other="Archived # templates" />,
        failed: t`Couldn’t archive the templates`,
      }),
    );

  // One Save panel per file (the contract saves one at a time); Cancel stops the rest.
  const exportFiles = () =>
    run('export', async () => {
      let saved = 0;
      for (const templateId of ids) {
        const result = await callRpc(backend.files.saveTemplateAs({ templateId }));
        if (!result.ok) {
          toast({
            tone: 'danger',
            title: t`Couldn’t save the template file`,
            description: libraryErrorText(i18n, result.error),
          });
          break;
        }
        if (!result.value.saved) break;
        saved += 1;
      }
      if (saved > 0)
        toast({ title: <Plural value={saved} one="Saved # template file" other="Saved # template files" /> });
    });

  return (
    <div
      role="toolbar"
      aria-label={t`Selected templates`}
      data-slot="bulk-bar"
      className="flex flex-wrap items-center gap-1.5 rounded-xl border border-rule bg-raised p-1.5 ps-4"
    >
      <span className="me-2 text-sm font-medium text-ink tabular-nums" aria-live="polite">
        <Plural value={count} one="# selected" other="# selected" />
      </span>
      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setTagging(true)}>
        <Tag aria-hidden />
        {t`Tag…`}
      </Button>
      {/* Not modal: the list and its bar stay as they are under the menu (no aria-hidden over them, WCAG 4.1.2). */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null && busy !== 'move'}
            loading={busy === 'move'}
          >
            <FolderInput aria-hidden />
            {t`Move to…`}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 min-w-52 overflow-y-auto">
          <DropdownMenuLabel>{t`Move to`}</DropdownMenuLabel>
          {folders.map((folder) => (
            <DropdownMenuItem key={folder.id} onSelect={() => void move(folder)}>
              <Folder aria-hidden />
              <UserContent translate="no">{folder.name}</UserContent>
            </DropdownMenuItem>
          ))}
          {folders.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => void move(null)}>
            <FolderX aria-hidden />
            {t`Not in a folder`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy !== null && busy !== 'favourite'}
        loading={busy === 'favourite'}
        onClick={() => void favourite()}
      >
        <Star aria-hidden />
        {allFavourite ? t`Unfavourite` : t`Favourite`}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy !== null && busy !== 'export'}
        loading={busy === 'export'}
        onClick={() => void exportFiles()}
      >
        <Download aria-hidden />
        {t`Export`}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy !== null && busy !== 'archive'}
        loading={busy === 'archive'}
        onClick={() => void archive()}
      >
        <Archive aria-hidden />
        {t`Archive`}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="ms-auto size-8"
        aria-label={t`Clear selection`}
        onClick={onClear}
      >
        <X aria-hidden />
      </Button>
      <TagDialog open={tagging} onOpenChange={setTagging} templates={selected} suggestions={tagSuggestions} />
    </div>
  );
}
