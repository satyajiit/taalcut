// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: design files list (HFW1-UI) · genre: atmospheric studio app (the editor's dock)
 * system: DESIGN.md v0.3 · a design's files grouped under their folders (the folder a quiet label, each file its
 *   glyph, its name as the model wrote it and its size as data); the open one carries the selected wash
 * keyboard: one tab stop (a listbox, as the bed's lanes): ↑ ↓ Home End move, Return opens; a press opens at once
 * states: default · hover · focus (the base ring on the list, the active row outlined) · selected · empty (one
 *   line: no files) · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { WorkspaceFile } from '@taalcut/core';
import { cn, CONCEPT_ICONS, renderIcon, useFormatters, UserContent } from '@taalcut/ui';
import { useId, useMemo } from 'react';
import { useLaneListbox } from '../use-lane-listbox';
import { fileGroups, listedPaths } from './files-model';

export interface FileListProps {
  readonly files: readonly WorkspaceFile[];
  readonly open: string | null;
  readonly onOpen: (path: string) => void;
}

/** Bytes as a size: "1.2 kB". */
function useSize() {
  const { i18n } = useLingui();
  return (bytes: number) =>
    bytes < 1000
      ? i18n.number(bytes, { style: 'unit', unit: 'byte', unitDisplay: 'narrow' })
      : i18n.number(bytes / 1000, {
          style: 'unit',
          unit: 'kilobyte',
          unitDisplay: 'short',
          maximumFractionDigits: 1,
        });
}

export function FileList({ files, open, onOpen }: FileListProps) {
  const { t } = useLingui();
  const size = useSize();
  useFormatters();
  const groups = useMemo(() => fileGroups(files), [files]);
  const paths = useMemo(() => listedPaths(groups), [groups]);
  const list = useLaneListbox(paths, open, onOpen);
  const labelPrefix = useId();
  if (files.length === 0) return <p className="m-0 type-meta text-ink-2">{t`This version has no files.`}</p>;
  return (
    <div
      {...list.listbox}
      aria-label={t`Files`}
      data-slot="design-file-list"
      className="flex flex-col gap-1 rounded-md p-0.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
    >
      {groups.map((group, index) => (
        <div
          key={group.folder || '.'}
          role="group"
          aria-labelledby={group.folder ? `${labelPrefix}-${index}` : undefined}
          aria-label={group.folder ? undefined : t`At the top`}
        >
          {group.folder ? (
            <div
              id={`${labelPrefix}-${index}`}
              className="flex items-center gap-1.5 px-2 pt-1 pb-0.5 type-meta text-ink-3"
            >
              {renderIcon(CONCEPT_ICONS.designFiles, 'sm')}
              <UserContent translate="no">{group.folder}/</UserContent>
            </div>
          ) : null}
          {group.files.map((file) => {
            const selected = file.path === open;
            const active = file.path === list.active;
            const isMotionGraphic = Boolean(group.folder && file.name.toLowerCase() === 'index.html');
            return (
              <div
                key={file.path}
                id={list.optionId(file.path)}
                role="option"
                aria-selected={selected}
                data-path={file.path}
                className={cn(
                  'flex min-h-8 cursor-pointer items-center gap-2 rounded-md py-1 pe-2 text-sm text-ink-2 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover hover:text-ink',
                  group.folder ? 'ps-6' : 'ps-2',
                  selected && 'bg-selected text-ink hover:bg-selected',
                  active && 'outline-1 -outline-offset-1 outline-rule-strong',
                )}
                onClick={() => {
                  list.setActive(file.path);
                  onOpen(file.path);
                }}
              >
                <span aria-hidden className="shrink-0 text-ink-3">
                  {renderIcon(isMotionGraphic ? CONCEPT_ICONS.graphic : CONCEPT_ICONS.file, 'sm')}
                </span>
                <UserContent translate="no" className="min-w-0 flex-1 truncate font-medium">
                  {isMotionGraphic ? `${group.folder} (${file.name})` : file.name}
                </UserContent>
                {isMotionGraphic ? (
                  <span className="shrink-0 rounded-pill bg-chip px-1.5 py-0.5 text-[11px] text-ink-2">
                    {t`Motion graphic`}
                  </span>
                ) : null}
                <span className="shrink-0 type-data text-ink-3 tabular-nums">{size(file.bytes)}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
