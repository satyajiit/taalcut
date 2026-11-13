// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: commit fields (brand kit editor) · genre: atmospheric studio app (chrome modern-minimal)
 *   · system: DESIGN.md v0.3
 * the editor's text field and slider that save once, when the person is done: on blur or Enter for text (Escape
 *   puts it back), on release or a key for a slider (its value said in words beside it), never per keystroke
 * states: default · hover · focus-visible (base ring) · active (typing, dragging) · disabled (read-only kit) ·
 *   loading (saving: aria-busy, the field keeps its focus) · error (danger edge and the reason under it, Escape
 *   restores) · success (the editor's status line says Saved)
 * pre-emit critique: P4 H4 E4 S4 R5 V4
 */
import { cn, Input } from '@taalcut/ui';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface CommitInputProps {
  readonly label: ReactNode;
  readonly value: string;
  /** Saves; resolves false when it was refused (the field keeps what was typed). */
  readonly onCommit: (value: string) => Promise<boolean> | void;
  /** Why what was typed can't be saved, in words; null when it can. */
  readonly validate?: (value: string) => string | null;
  readonly hint?: ReactNode;
  readonly maxLength?: number;
  readonly disabled?: boolean;
  /** The person's own words (a kit name, a watermark): never translated. */
  readonly userContent?: boolean;
  readonly className?: string;
}

export function CommitInput({
  label,
  value,
  onCommit,
  validate,
  hint,
  maxLength,
  disabled,
  userContent,
  className,
}: CommitInputProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const editing = useRef(false);
  // A change from elsewhere (⌘Z, the agent) shows unless the person is typing.
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  const problem = draft === value ? null : (validate?.(draft) ?? null);

  const commit = async () => {
    editing.current = false;
    if (draft === value || problem) return;
    setSaving(true);
    const saved = await onCommit(draft);
    setSaving(false);
    if (saved === false) editing.current = true;
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={id} className="type-label text-ink">
        {label}
      </label>
      <Input
        id={id}
        value={draft}
        maxLength={maxLength}
        disabled={disabled}
        translate={userContent ? 'no' : undefined}
        status={problem ? 'error' : undefined}
        aria-busy={saving || undefined}
        aria-describedby={problem ? `${id}-problem` : hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          editing.current = true;
          setDraft(event.target.value);
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          } else if (event.key === 'Escape' && draft !== value) {
            event.preventDefault();
            editing.current = false;
            setDraft(value);
          }
        }}
      />
      {problem ? (
        <p id={`${id}-problem`} className="m-0 type-meta text-danger-strong">
          {problem}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="m-0 type-meta text-ink-2">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface CommitRangeProps {
  readonly label: ReactNode;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** The value in words: "14% of the width". */
  readonly words: (value: number) => string;
  readonly onCommit: (value: number) => void;
  readonly disabled?: boolean;
}

/** A slider that saves on release (pointer) or on each key (keyboard), never while dragging. */
export function CommitRange({ label, value, min, max, step, words, onCommit, disabled }: CommitRangeProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => setDraft(value), [value]);
  // The native change event fires when a drag ends or a key moves it: one save per gesture.
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const changed = () => commitRef.current(Number(input.value));
    input.addEventListener('change', changed);
    return () => input.removeEventListener('change', changed);
  }, []);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="type-label text-ink">
          {label}
        </label>
        <span className="type-data text-ink-2">{words(draft)}</span>
      </div>
      <input
        ref={ref}
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-valuetext={words(draft)}
        onChange={(event) => setDraft(Number(event.target.value))}
        className="h-6 w-full cursor-pointer accent-primary-strong disabled:cursor-not-allowed"
      />
    </div>
  );
}
