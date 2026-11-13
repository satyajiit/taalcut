// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: design file code (HFW1-UI) · genre: atmospheric studio app (the editor's dock)
 * system: DESIGN.md v0.3 · one file of a design as the AI wrote it, read only: its path and a "Read only" chip,
 *   then the code in the well (`well`, the mono face, line numbers in ink-3 that a screen reader skips), which
 *   scrolls both ways inside itself and takes focus so the keyboard can scroll it. The code is the model's: shown
 *   as text, never run, never translated
 * states: loading (bones) · default · no text (a picture or other data: one line) · error (the cause and Try
 *   again) · empty (no file chosen: nothing) · pre-emit critique: P5 H4 E4 S4 R5 V4 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { ProjectId, WorkspaceFile } from '@taalcut/core';
import {
  Button,
  Chip,
  CONCEPT_ICONS,
  ErrorLine,
  MarkdownText,
  renderIcon,
  SkeletonLines,
  UserContent,
} from '@taalcut/ui';
import { useId, useState } from 'react';
import { useFileText } from './use-workspace';

export interface CodeViewProps {
  readonly projectId: ProjectId;
  readonly file: WorkspaceFile | null;
}

export function CodeView({ projectId, file }: CodeViewProps) {
  const { t } = useLingui();
  const read = useFileText(projectId, file?.sha256 ?? null);
  const labelId = useId();
  const [mode, setMode] = useState<'preview' | 'code'>('preview');
  if (!file) return null;
  const slash = file.path.lastIndexOf('/');
  const folder = slash >= 0 ? file.path.slice(0, slash) : '';
  const name = file.path.slice(slash + 1);
  const isMotionGraphic = Boolean(folder && name.toLowerCase() === 'index.html');
  const isMarkdown = name.toLowerCase().endsWith('.md');
  const text = read.status === 'ready' ? read.data?.text : undefined;
  return (
    <div data-slot="design-code" className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="shrink-0 text-ink-3">
          {renderIcon(isMotionGraphic ? CONCEPT_ICONS.graphic : CONCEPT_ICONS.file, 'sm')}
        </span>
        <UserContent translate="no" className="min-w-0 flex-1 truncate type-meta text-ink-2">
          {isMotionGraphic ? `${folder} · ${file.path}` : file.path}
        </UserContent>
        {isMotionGraphic ? <Chip tone="neutral">{t`Motion graphic`}</Chip> : null}
        {isMarkdown ? (
          <Button
            size="sm"
            variant="ghost"
            data-slot="markdown-mode-toggle"
            onClick={() => setMode(mode === 'preview' ? 'code' : 'preview')}
          >
            {mode === 'preview' ? <Trans>Code</Trans> : <Trans>Preview</Trans>}
          </Button>
        ) : null}
        <Chip tone="neutral">{t`Read only`}</Chip>
      </div>
      {read.status === 'error' ? (
        <ErrorLine key={read.error.code} error={read.error} onRetry={read.reload} />
      ) : read.status === 'loading' ? (
        <SkeletonLines lines={6} className="rounded-md bg-well p-3" />
      ) : text === null || text === undefined ? (
        <p className="m-0 rounded-md bg-well p-3 type-meta text-ink-2">
          {t`This file is a picture or other data, so there’s no text to show.`}
        </p>
      ) : isMarkdown && mode === 'preview' ? (
        <div
          role="region"
          aria-labelledby={labelId}
          tabIndex={0}
          data-slot="design-markdown-preview"
          className="max-h-[22rem] overflow-auto rounded-md bg-well p-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          <span id={labelId} className="sr-only">
            <Trans>
              The preview of <UserContent translate="no">{name}</UserContent>, read only
            </Trans>
          </span>
          <MarkdownText text={text} />
        </div>
      ) : (
        <div
          role="region"
          aria-labelledby={labelId}
          tabIndex={0}
          data-slot="design-code-text"
          className="max-h-[22rem] overflow-auto rounded-md bg-well focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
        >
          {/* Its name for a screen reader: the file's name as written, the words around it translated. */}
          <span id={labelId} className="sr-only">
            <Trans>
              The code of <UserContent translate="no">{name}</UserContent>, read only
            </Trans>
          </span>
          <pre translate="no" className="m-0 flex min-w-max p-3 font-mono text-xs leading-5">
            <span aria-hidden className="pe-3 text-end text-ink-3 select-none tabular-nums">
              {text.split('\n').map((_, index) => (
                <span key={index} className="block">
                  {index + 1}
                </span>
              ))}
            </span>
            <code data-user-content className="text-ink">
              {text}
            </code>
          </pre>
        </div>
      )}
    </div>
  );
}
