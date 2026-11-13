// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: template folders (Your templates; UX4 tpl) · system: DESIGN.md v0.6 + UX4
 * left of the list, unboxed on the canvas: All templates, Favourites, Not in a folder, then Folders with New folder;
 *   each folder its name as written and its count. Every place is a link (/templates, /templates/folders/$folderId,
 *   favourites and unfiled included), so a folder has a URL, Back works and the view's search and filters go with
 *   you; the current one sits on the views' raised thumb (aria-current="page"), never the selection wash rows use.
 *   ⋯ renames (in place) or deletes a folder (Undo in the toast)
 * states: item default · hover (hover surface, ink) · focus-visible (base ring) · active (pressed, gives by 1 %) ·
 *   current (raised, rule edge, ink) · disabled n/a · loading (bone rows while the folders load) · error (the cause,
 *   Try again) · success (the toast); New folder and ⋯ are ghost icon buttons with the same eight
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { newId, TEMPLATE_FOLDER_COMMANDS, type TemplateFolder, type TemplateFolderId } from '@taalcut/core';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ErrorLine,
  PRESS_ROW,
  renderIcon,
  UserContent,
  VERB_ICONS,
  type IconLike,
} from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { FolderPlus, MoreHorizontal } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Loadable } from '../../../backend/use-rpc';
import { TEMPLATE_ICONS } from '../template-icons';
import { FolderNameField } from './folder-name-field';
import type { TemplateSearch } from './template-search';
import { useLibraryCommands } from './use-library-commands';

export interface FolderRailProps {
  readonly folder: TemplateSearch['folder'];
  /** Goes to a place without a click on its link: a folder just made, or All templates after deleting this one. */
  readonly onFolder: (folder: TemplateSearch['folder']) => void;
  readonly folders: Loadable<readonly TemplateFolder[]> & { reload: () => void };
  /** Templates in the library, archived ones aside. */
  readonly total: number | undefined;
}

const ITEM = cn(
  'flex h-8 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-start type-label text-ink-2',
  PRESS_ROW,
  'hover:bg-hover hover:text-ink active:bg-pressed [&_[data-slot=glyph]]:text-ink-3',
  'aria-[current=page]:bg-raised aria-[current=page]:text-ink aria-[current=page]:shadow-xs aria-[current=page]:ring-1 aria-[current=page]:ring-rule',
  'aria-[current=page]:[&_[data-slot=glyph]]:text-ink-2',
);

/** One place in the rail: a link to the list at that place, keeping the view's search and filters. */
function RailItem(props: {
  place: TemplateSearch['folder'];
  current: boolean;
  icon: IconLike;
  count?: number | undefined;
  children: ReactNode;
}) {
  const { i18n } = useLingui();
  const body = (
    <>
      {renderIcon(props.icon, 'md')}
      <span className="min-w-0 flex-1 truncate">{props.children}</span>
      {props.count !== undefined ? (
        <span className="shrink-0 type-meta text-ink-3 tabular-nums">{i18n.number(props.count)}</span>
      ) : null}
    </>
  );
  const current = props.current ? ('page' as const) : undefined;
  return props.place ? (
    <Link
      activeOptions={{ exact: true }}
      to="/templates/folders/$folderId"
      params={{ folderId: props.place }}
      search={true}
      aria-current={current}
      className={ITEM}
    >
      {body}
    </Link>
  ) : (
    <Link
      activeOptions={{ exact: true }}
      to="/templates"
      search={true}
      aria-current={current}
      className={ITEM}
    >
      {body}
    </Link>
  );
}

export function FolderRail({ folder, onFolder, folders, total }: FolderRailProps) {
  const { t } = useLingui();
  const commands = useLibraryCommands();
  const [editing, setEditing] = useState<'new' | TemplateFolderId | null>(null);

  const create = async (name: string) => {
    const folderId = newId<'TemplateFolder'>();
    const created = await commands.run({
      steps: [{ name: TEMPLATE_FOLDER_COMMANDS.create, payload: { projectId: null, folderId, name } }],
      done: null,
      failed: t`Couldn’t make the folder`,
      toast: false,
    });
    if (!created.ok) return created.error;
    setEditing(null);
    folders.reload();
    onFolder(folderId);
    return null;
  };
  const rename = async (folderId: TemplateFolderId, name: string) => {
    const renamed = await commands.run({
      steps: [{ name: TEMPLATE_FOLDER_COMMANDS.rename, payload: { projectId: null, folderId, name } }],
      done: null,
      failed: t`Couldn’t rename the folder`,
      toast: false,
    });
    if (!renamed.ok) return renamed.error;
    setEditing(null);
    folders.reload();
    return null;
  };
  const remove = (item: TemplateFolder) => {
    const count = item.templates;
    void commands
      .run({
        steps: [{ name: TEMPLATE_FOLDER_COMMANDS.remove, payload: { projectId: null, folderId: item.id } }],
        done:
          count === 0 ? (
            t`Folder deleted`
          ) : (
            <Plural
              value={count}
              one="Folder deleted. Its template is now in Not in a folder."
              other="Folder deleted. Its # templates are now in Not in a folder."
            />
          ),
        failed: t`Couldn’t delete the folder`,
      })
      .then((done) => {
        if (done.ok && folder === item.id) onFolder(undefined);
        folders.reload();
      });
  };

  return (
    // data-view-links: a place picked here swaps the list like a view, so the shell's page turn can skip it.
    <nav
      aria-label={t`Template folders`}
      className="flex flex-col gap-4"
      data-slot="folder-rail"
      data-view-links=""
    >
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        <li>
          <RailItem place={undefined} current={folder === undefined} icon={TEMPLATE_ICONS.all} count={total}>
            {t`All templates`}
          </RailItem>
        </li>
        <li>
          <RailItem place="favourites" current={folder === 'favourites'} icon={TEMPLATE_ICONS.favourites}>
            {t`Favourites`}
          </RailItem>
        </li>
        <li>
          <RailItem place="unfiled" current={folder === 'unfiled'} icon={TEMPLATE_ICONS.unfiled}>
            {t`Not in a folder`}
          </RailItem>
        </li>
      </ul>

      <section aria-labelledby="template-folders-heading" className="flex flex-col gap-1">
        <div className="flex items-center justify-between ps-2.5">
          <h2 id="template-folders-heading" className="m-0 type-caption text-ink-3">
            {t`Folders`}
          </h2>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={t`New folder`}
            onClick={() => setEditing('new')}
          >
            <FolderPlus aria-hidden />
          </Button>
        </div>
        {folders.error && !folders.data ? (
          <div className="flex flex-col items-start gap-2 ps-2.5">
            <ErrorLine error={folders.error} />
            <Button size="sm" variant="ghost" icon={VERB_ICONS.retry} onClick={folders.reload}>
              {t`Try again`}
            </Button>
          </div>
        ) : !folders.data ? (
          <ul
            aria-busy="true"
            aria-label={t`Loading folders`}
            className="m-0 flex list-none flex-col gap-1 p-0"
          >
            {[0, 1].map((i) => (
              <li key={i} aria-hidden className="tc-bone h-8 rounded-md bg-hover" />
            ))}
          </ul>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {folders.data.map((item) => {
              const folderName = item.name;
              return editing === item.id ? (
                <li key={item.id}>
                  <FolderNameField
                    initial={item.name}
                    label={t`Folder name`}
                    onSave={(name) => rename(item.id, name)}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={item.id} data-current={folder === item.id || undefined} className="group relative">
                  <RailItem
                    place={item.id}
                    current={folder === item.id}
                    icon={TEMPLATE_ICONS.folder}
                    count={item.templates}
                  >
                    <UserContent translate="no">{item.name}</UserContent>
                  </RailItem>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn(
                        'absolute end-0.5 top-0 flex size-8 cursor-pointer items-center justify-center rounded-md bg-canvas text-ink-3 opacity-0 group-data-[current]:bg-raised',
                        'transition-opacity duration-(--dur-micro) ease-(--ease-out) group-hover:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 active:bg-pressed data-[state=open]:opacity-100',
                      )}
                    >
                      <MoreHorizontal aria-hidden className="size-4" />
                      <span className="sr-only">
                        <Trans>
                          More for <UserContent translate="no">{folderName}</UserContent>
                        </Trans>
                      </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(item.id)}>
                        {renderIcon(VERB_ICONS.rename, 'md')}
                        {t`Rename`}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => remove(item)}>
                        {renderIcon(VERB_ICONS.delete, 'md')}
                        {t`Delete folder`}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
            {editing === 'new' ? (
              <li>
                <FolderNameField
                  initial=""
                  label={t`New folder name`}
                  onSave={create}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : folders.data.length === 0 ? (
              <li className="px-2.5 py-1 type-meta text-ink-2">{t`Folders you make show here.`}</li>
            ) : null}
          </ul>
        )}
      </section>
    </nav>
  );
}
