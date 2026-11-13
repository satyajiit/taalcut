// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: folder name field (in the rail) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a small field in place of the folder's row: Enter saves, Escape or leaving it empty puts the row back
 * states: default · hover (strong rule) · focus-visible (base ring, focused on open) · active n/a · disabled (while
 *   saving) · loading (spinner at the end) · error (danger rule and the cause under it, focus kept) · success (the
 *   row comes back with the name)
 * pre-emit critique: P5 H5 E4 S5 R4 V4
 */
import { useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import { cn } from '@taalcut/ui';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import { useId, useState } from 'react';
import { libraryErrorText } from './library-words';

export interface FolderNameFieldProps {
  readonly initial: string;
  readonly label: string;
  /** Resolves with the error to show, or null once saved. */
  readonly onSave: (name: string) => Promise<TaalcutError | null>;
  readonly onCancel: () => void;
}

const MAX = 60;

export function FolderNameField({ initial, label, onSave, onCancel }: FolderNameFieldProps) {
  const { i18n } = useLingui();
  const id = useId();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);

  const save = async () => {
    const name = value.trim();
    if (!name || name === initial) return onCancel();
    setSaving(true);
    const failed = await onSave(name);
    setSaving(false);
    setError(failed);
  };

  return (
    <div className="flex flex-col gap-1 py-0.5">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span className="relative flex items-center">
        <FolderOpen aria-hidden className="pointer-events-none absolute start-2.5 size-4 text-ink-3" />
        <input
          id={id}
          // The field opens because the person asked for it: it takes the cursor.
          autoFocus
          value={value}
          maxLength={MAX}
          disabled={saving}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void save();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
          onBlur={() => {
            if (!saving && !error) void save();
          }}
          className={cn(
            'h-8 w-full rounded-md border border-rule-strong bg-raised ps-8 pe-7 text-sm text-ink',
            'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:border-ink-3 disabled:text-ink-disabled',
            error && 'border-danger-strong',
          )}
        />
        {saving ? (
          <LoaderCircle aria-hidden className="absolute end-2 size-4 animate-spin text-ink-3" />
        ) : null}
      </span>
      {error ? (
        <p id={`${id}-error`} role="alert" className="m-0 text-xs text-danger-strong">
          {libraryErrorText(i18n, error)}
        </p>
      ) : null}
    </div>
  );
}
