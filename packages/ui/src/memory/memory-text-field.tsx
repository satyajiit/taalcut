// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: memory text field (LRN1-MEM) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the words of a remembered item, written or edited in place: a textarea in the Input's
 *   skin (raised surface, rule-strong edge), up to `max` characters (core's MEMORY_TEXT_MAX) with a quiet count once
 *   you are near it. Return saves (Shift+Return starts a new line), Escape cancels
 * states: default · hover (edge ink-3) · focus (canvas, edge ink-2, base ring) · active (typing) · disabled (sunken)
 *   · loading (saving: read-only, aria-busy) · error (danger-strong edge, aria-invalid; the cause is the caller's)
 *   · success (the caller closes it)
 */
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { ComponentProps, KeyboardEvent } from 'react';
import { cn } from '#lib/cn';

/** The count shows once this much of the limit is used. */
const COUNT_FROM = 0.8;

export interface MemoryTextFieldProps extends Omit<
  ComponentProps<'textarea'>,
  'value' | 'onChange' | 'onSubmit'
> {
  readonly value: string;
  /** The most characters an item holds (core's MEMORY_TEXT_MAX: the kit imports only core's types). */
  readonly max: number;
  onValueChange(value: string): void;
  /** Return (without Shift). */
  onSubmit(): void;
  /** Escape. */
  onCancel?(): void;
  readonly saving?: boolean;
  readonly invalid?: boolean;
}

export function MemoryTextField({
  value,
  max,
  onValueChange,
  onSubmit,
  onCancel,
  saving = false,
  invalid = false,
  className,
  ...props
}: MemoryTextFieldProps) {
  const { t } = useLingui();
  const left = max - value.length;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    } else if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <textarea
        data-slot="memory-text-field"
        rows={2}
        maxLength={max}
        value={value}
        readOnly={saving}
        aria-busy={saving || undefined}
        aria-invalid={invalid || undefined}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn(
          'field-sizing-content min-h-16 w-full min-w-0 resize-none rounded-md border border-rule-strong bg-raised px-3 py-2',
          'type-body text-ink shadow-xs transition-[border-color,background-color] duration-(--dur-micro) ease-(--ease-out)',
          'placeholder:text-ink-3 hover:border-ink-3 focus-visible:border-ink-2 focus-visible:bg-canvas',
          'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-sunken disabled:text-ink-disabled',
          'read-only:bg-sunken aria-invalid:border-danger-strong',
          className,
        )}
        {...props}
      />
      {value.length >= max * COUNT_FROM ? (
        <span className="self-end type-meta text-ink-3 tabular-nums" aria-live="polite">
          {t`${plural(left, { one: '# character left', other: '# characters left' })}`}
        </span>
      ) : null}
    </div>
  );
}
