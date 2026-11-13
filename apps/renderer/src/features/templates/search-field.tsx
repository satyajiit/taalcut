// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: search field (Templates, the hub) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * one field on the raised surface with the search mark inside it and a clear button while it has words; Escape
 *   clears it, ⌘F puts the cursor in it (as in Finder) where the page asks for that. The same field on both lists.
 *   LRN1-TPL: where the page offers suggestions (the Templates page's search by meaning), the field is a combobox
 *   with its panel under it (search/use-search-combobox.tsx)
 * states: default · hover (strong rule) · focus-visible (base ring) · typing (clear button: default · hover ·
 *   focus-visible · active) · open (the panel under it) · disabled n/a · loading/error/success: the list or the
 *   panel under it answers
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 */
import { useLingui } from '@lingui/react/macro';
import { cn, isEditableTarget } from '@taalcut/ui';
import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { useSearchCombobox } from './search/use-search-combobox';

/** ⌘F, as aria-keyshortcuts names it. */
const FIND_KEYS = 'Meta+F';

export interface SearchFieldProps {
  /** The field's name for screen readers ("Search your templates"). */
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Return: take the words now instead of after the pause. */
  readonly onSubmit?: () => void;
  /** ⌘F focuses it. */
  readonly findShortcut?: boolean;
}

export function SearchField({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  findShortcut,
}: SearchFieldProps) {
  const { t } = useLingui();
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const combobox = useSearchCombobox();

  useEffect(() => {
    if (!findShortcut) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'f' &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        field.current?.focus();
        field.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [findShortcut]);

  return (
    <form
      role="search"
      className="relative min-w-0"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
      onBlur={combobox.onBlur}
    >
      <label htmlFor={fieldId} className="sr-only">
        {label}
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3"
      />
      <input
        ref={field}
        id={fieldId}
        type="search"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          combobox.onType();
        }}
        onFocus={combobox.onFocus}
        onKeyDown={(event) => {
          if (combobox.onKey(event)) return;
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            onChange('');
          }
        }}
        placeholder={placeholder}
        aria-keyshortcuts={findShortcut ? FIND_KEYS : undefined}
        {...combobox.input}
        className={cn(
          'h-10 w-full rounded-lg border border-rule-strong bg-raised ps-10 text-base text-ink placeholder:text-ink-3',
          // Room for the clear button only while it's there: the empty field gives its placeholder the width.
          value ? 'pe-11' : 'pe-3',
          'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:border-ink-3',
          '[&::-webkit-search-cancel-button]:appearance-none',
        )}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange('');
            field.current?.focus();
          }}
          className="absolute end-1.5 top-1/2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-ink-3 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover hover:text-ink active:bg-pressed"
        >
          <X aria-hidden className="size-4" />
          <span className="sr-only">{t`Clear search`}</span>
        </button>
      ) : null}
      {combobox.panel}
    </form>
  );
}
