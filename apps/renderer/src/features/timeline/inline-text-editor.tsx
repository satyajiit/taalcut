// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { Result } from '@taalcut/core';
import { useRef, useState, type CSSProperties } from 'react';

interface InlineTextEditorProps {
  words: string;
  style: CSSProperties;
  paused: boolean;
  onSave: (words: string) => Promise<Result<unknown>>;
  onClose: () => void;
}

export function InlineTextEditor({ words, style, paused, onSave, onClose }: InlineTextEditorProps) {
  const { t } = useLingui();
  const field = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const save = async (value: string) => {
    if (finished.current || saving.current || paused) return;
    const next = value.trim();
    if (!next || next === words) {
      finished.current = true;
      onClose();
      return;
    }
    saving.current = true;
    setBusy(true);
    const result = await onSave(next);
    saving.current = false;
    setBusy(false);
    if (result.ok) {
      finished.current = true;
      onClose();
    } else field.current?.focus();
  };
  return (
    <input
      ref={field}
      autoFocus
      defaultValue={words}
      aria-label={t`Text on screen`}
      maxLength={500}
      readOnly={paused || busy}
      aria-busy={busy || undefined}
      data-slot="text-edit"
      className="absolute z-20 h-7 rounded-sm border border-rule-strong bg-raised px-1.5 text-xs text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      style={style}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          void save(event.currentTarget.value);
        } else if (event.key === 'Escape' && !busy) {
          finished.current = true;
          onClose();
        }
      }}
      onBlur={(event) => void save(event.currentTarget.value)}
    />
  );
}
