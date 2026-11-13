// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { useTimecode } from '@taalcut/ui';
import { Layers } from 'lucide-react';
import { useEditorContext } from '../editor-context';
import type { PositionView } from '../model';

export function ProgramBlock({
  position,
  width,
  onOpen,
}: {
  position: PositionView;
  width: number;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const time = useTimecode();
  const editor = useEditorContext();
  return (
    <div
      role="option"
      aria-selected={!editor?.selection}
      aria-label={t`Video design`}
      tabIndex={0}
      data-slot="program-block"
      style={{ width }}
      className="flex h-16 shrink-0 cursor-pointer items-center gap-3 overflow-hidden rounded-md border border-ai-strong bg-ai-soft px-4 text-ink focus-visible:outline-2 focus-visible:outline-focus"
      onClick={() => {
        editor?.select(null);
        onOpen();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          editor?.select(null);
          onOpen();
        }
      }}
    >
      <Layers aria-hidden className="size-4 shrink-0 text-ai-strong" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate type-label">{t`Video design`}</span>
        {editor ? (
          <span className="type-meta text-ink-2">
            {time.length(position.end - position.start, editor.model.rate)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
