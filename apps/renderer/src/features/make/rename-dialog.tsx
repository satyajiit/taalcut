// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: rename dialog · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * one field with the name as written, selected on open; Save and Cancel. Used for a project and for a version.
 * states: default · hover/focus/active (the Input's and Buttons') · disabled (Save, while the name is empty or
 *   unchanged) · loading (Save spins while the command runs) · error (the cause under the field; the dialog stays)
 *   · success (the dialog closes; the list shows the new name, and the toast offers Undo)
 * pre-emit critique: P5 H5 E4 S4 R5 V3
 */
import { useLingui } from '@lingui/react/macro';
import type { Result } from '@taalcut/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  errorMessage,
  Input,
} from '@taalcut/ui';
import { useEffect, useId, useState, type FormEvent } from 'react';

export interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  /** The name now, as written. */
  value: string;
  maxLength: number;
  /** Runs the command; the dialog closes on success. */
  onSave: (name: string) => Promise<Result<unknown>>;
}

export function RenameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  value,
  maxLength,
  onSave,
}: RenameDialogProps) {
  const { t, i18n } = useLingui();
  const fieldId = useId();
  const errorId = useId();
  const [name, setName] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(value);
      setError(null);
    }
  }, [open, value]);

  const trimmed = name.trim();
  const unchanged = trimmed === value.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || unchanged || saving) return;
    setSaving(true);
    const result = await onSave(trimmed);
    setSaving(false);
    if (result.ok) onOpenChange(false);
    else setError(errorMessage(i18n, result.error));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={fieldId} className="text-sm font-medium text-ink">
              {label}
            </label>
            <Input
              id={fieldId}
              value={name}
              maxLength={maxLength}
              autoComplete="off"
              spellCheck={false}
              translate="no"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
            />
            {error ? (
              <p id={errorId} role="alert" className="m-0 text-sm text-danger-strong">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t`Cancel`}
            </Button>
            <Button type="submit" variant="primary" loading={saving} disabled={!trimmed || unchanged}>
              {t`Save`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
