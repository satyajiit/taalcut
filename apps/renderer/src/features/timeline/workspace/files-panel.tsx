// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: design files (HFW1-UI) · genre: atmospheric studio app (the editor's dock)
 * system: DESIGN.md v0.3 · the dock's Files tab: the files behind a graphic the AI designed, read only. Which
 *   design (when the video has more than one), its name (the model's words, as content) and version, then three
 *   parts under icon-led headings on the plain canvas: Files (the list and the chosen file's code), Checks (what
 *   it passed before it went on the video) and History (every version of the project's design files: choosing one
 *   shows its files; Restore makes it the current one, one ⌘Z). Nothing here edits a design: a change is asked of
 *   the AI in the chat
 * states: loading (bones) · default · a version's files (its number, no checks) · empty (no designs and no files
 *   yet: a status line) · error (the cause and Try again) · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import {
  WORKSPACE_COMMANDS,
  type ProjectId,
  type TaalcutError,
  type Timeline,
  type WorkspaceFile,
} from '@taalcut/core';
import {
  CONCEPT_ICONS,
  EmptyState,
  ErrorLine,
  renderIcon,
  Select,
  SkeletonLines,
  UserContent,
  type IconLike,
} from '@taalcut/ui';
import { plural } from '@lingui/core/macro';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useCommand } from '../../../backend/use-command';
import { CodeView } from './code-view';
import { DesignChecks } from './design-checks';
import { FileList } from './file-list';
import { designOfItem, designsOn, fileGroups, firstFile } from './files-model';
import type { FilesRequest } from './files-requests';
import { RevisionList } from './revision-list';
import { useWorkspaceListing } from './use-workspace';

export interface FilesPanelProps {
  readonly projectId: ProjectId;
  readonly timeline: Timeline;
  /** The latest "show this graphic's files". */
  readonly request: FilesRequest | null;
}

/** What the files list shows: a design on the video, or a version of the project's files. */
type Showing =
  | { readonly kind: 'design'; readonly key: string }
  | { readonly kind: 'revision'; readonly revision: number };

export function FilesPanel({ projectId, timeline, request }: FilesPanelProps) {
  const { t, i18n } = useLingui();
  const designs = useMemo(() => designsOn(timeline), [timeline]);
  const listing = useWorkspaceListing(projectId);
  const command = useCommand({ toast: false });
  const pickId = useId();
  const asked = request && request.timelineId === timeline.id ? designOfItem(designs, request.itemId) : null;
  const [showing, setShowing] = useState<Showing | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [restore, setRestore] = useState<{ busy: boolean; done: number | null; error: TaalcutError | null }>({
    busy: false,
    done: null,
    error: null,
  });

  // A View files names a graphic: its design shows, whatever was showing.
  useEffect(() => {
    if (asked) setShowing({ kind: 'design', key: asked.key });
  }, [asked?.key, request]);

  const head = listing.data?.head ?? 0;
  const current: Showing | null =
    showing && (showing.kind === 'revision' || designs.some((design) => design.key === showing.key))
      ? showing
      : designs[0]
        ? { kind: 'design', key: designs[0].key }
        : head > 0
          ? { kind: 'revision', revision: head }
          : null;
  const design =
    current?.kind === 'design' ? (designs.find((each) => each.key === current.key) ?? null) : null;
  const revision =
    current?.kind === 'revision'
      ? (listing.data?.revisions.find((each) => each.revision === current.revision) ?? null)
      : null;
  const files: readonly WorkspaceFile[] = design?.composition.files ?? revision?.files ?? [];
  const groups = useMemo(() => fileGroups(files), [files]);
  const openPath =
    open && files.some((file) => file.path === open)
      ? open
      : firstFile(groups, design?.composition.entry ?? null);
  const openFile = files.find((file) => file.path === openPath) ?? null;

  if (listing.status === 'loading' && designs.length === 0)
    return <SkeletonLines lines={5} className="p-4" />;
  if (!current)
    return (
      <div className="p-4">
        {listing.status === 'error' ? (
          <ErrorLine key={listing.error.code} error={listing.error} onRetry={listing.reload} />
        ) : (
          <EmptyState
            variant="compact"
            icon={CONCEPT_ICONS.designFiles}
            title={t`No designed graphics yet`}
            description={t`When Taalcut designs a graphic for this video, the files it wrote show here.`}
          />
        )}
      </div>
    );

  const runRestore = async (to: number) => {
    setRestore({ busy: true, done: null, error: null });
    const done = await command.run({
      name: WORKSPACE_COMMANDS.restore,
      payload: { projectId, revision: to },
    });
    setRestore({ busy: false, done: done.ok ? to : null, error: done.ok ? null : done.error });
  };
  const count = plural(files.length, { one: '# file', other: '# files' });
  const version = design ? i18n.number(design.composition.version) : '';
  const at = revision ? i18n.number(revision.revision) : '';

  return (
    <div data-slot="files-panel" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-5 p-4">
        <header className="flex flex-col gap-2">
          {designs.length > 1 ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={pickId} className="type-label text-ink-2">
                {t`Design`}
              </label>
              <Select
                id={pickId}
                value={design?.key ?? ''}
                onChange={(event) => {
                  setOpen(null);
                  setShowing({ kind: 'design', key: event.target.value });
                }}
              >
                {design ? null : <option value="">{t`A version of the files`}</option>}
                {designs.map((each) => (
                  <option key={each.key} value={each.key} translate="no">
                    {each.composition.name} · v{i18n.number(each.composition.version)}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <h2 className="m-0 type-card-title text-ink">
            {design ? (
              <UserContent translate="no" className="[overflow-wrap:anywhere]">
                {design.composition.name}
              </UserContent>
            ) : (
              t`The files at version ${at}`
            )}
          </h2>
          <p className="m-0 type-meta text-ink-2">
            {design ? t`Design v${version} · ${count} · read only` : t`${count} · read only`}
          </p>
        </header>

        <Part icon={CONCEPT_ICONS.file} title={t`Files`}>
          <FileList files={files} open={openPath} onOpen={(path) => setOpen(path)} />
          <CodeView projectId={projectId} file={openFile} />
        </Part>

        {design ? (
          <Part icon={CONCEPT_ICONS.checks} title={t`Checks`}>
            <DesignChecks gate={design.composition.gate} />
          </Part>
        ) : null}

        <Part
          icon={CONCEPT_ICONS.version}
          title={t`History`}
          description={t`Each time Taalcut changed the design files, a new version. Choose one to see its files.`}
        >
          {listing.status === 'error' && !listing.data ? (
            <ErrorLine key={listing.error.code} error={listing.error} onRetry={listing.reload} />
          ) : listing.data ? (
            <RevisionList
              listing={listing.data}
              viewing={revision?.revision ?? null}
              onView={(to) => {
                setOpen(null);
                setShowing({ kind: 'revision', revision: to });
              }}
              onRestore={(to) => void runRestore(to)}
              restoring={restore.busy}
              restored={restore.done}
              error={restore.error}
            />
          ) : (
            <SkeletonLines lines={2} />
          )}
        </Part>
      </div>
    </div>
  );
}

/** One part of the panel: an icon-led heading, a line under it, and what it holds. */
function Part({
  icon,
  title,
  description,
  children,
}: {
  icon: IconLike;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <h3 id={id} className="m-0 flex items-center gap-2 type-card-title text-ink">
          <span aria-hidden className="text-ink-3">
            {renderIcon(icon, 'md')}
          </span>
          {title}
        </h3>
        {description ? <p className="m-0 type-meta text-ink-2">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
