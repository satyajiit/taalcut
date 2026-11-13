// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ImportError } from './import-error';
import { useLingui } from '@lingui/react/macro';
import { IMPORT_COMMANDS, type ImportDraftId } from '@taalcut/core';
import { cn } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState, type DragEvent, type ReactNode } from 'react';
import { useImportCommand } from './use-import-command';

export function ImportDrop({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const command = useImportCommand();
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const drop = async (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    setNote(null);
    const files = [...event.dataTransfer.files];
    const paths = files
      .map((file) => window.taalcutFiles?.pathFor(file))
      .filter((path): path is string => Boolean(path));
    if (!paths.length || paths.length !== files.length) {
      setNote(t`Choose files with Import to let Taalcut read them.`);
      return;
    }
    const result = await command.run<{ draftId: ImportDraftId }>(IMPORT_COMMANDS.createDraft, {
      method: 'files',
      paths,
    });
    if (result)
      await navigate({
        to: '/library/import/$method/$draftId/review',
        params: { method: 'files', draftId: result.draftId },
      });
  };
  return (
    <div
      data-slot="library-drop"
      className={cn(
        'relative flex flex-col gap-4 rounded-lg transition-colors duration-(--dur-micro)',
        dragging && 'bg-selected outline-2 outline-primary-strong',
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => void drop(event)}
    >
      {dragging ? (
        <p role="status" className="m-0 p-3 type-label">{t`Drop files or folders to review an import`}</p>
      ) : null}
      {command.pending ? (
        <p role="status" className="m-0 type-body">{t`Preparing your footage for review…`}</p>
      ) : null}
      {command.error ? <ImportError error={command.error} /> : null}
      {note ? (
        <p role="status" className="m-0 type-body text-warning-strong">
          {note}
        </p>
      ) : null}
      {children}
    </div>
  );
}
