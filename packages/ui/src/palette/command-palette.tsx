// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: command palette · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 (A7: opens instantly) + v0.4 (UX1) · states: default · hover · focus (the search row's
 * hairline becomes a 2 px focus line while you type, instant, hidden in an inactive window; the active option
 * shows) · active (Return) · disabled options · loading (aria-busy) · error (one line: the danger icon and the
 * cause, no wash) · success (closes) · empty (nothing matches what you typed; no commands at all says so)
 * motion: the highlight glides to the next option (shared layout, --dur-micro, --ease-out); the options never
 *   move. It shows at once when the palette opens and when the list changes as you type. */

import { useLingui } from '@lingui/react/macro';
import { CircleAlert, LoaderCircle, Search } from 'lucide-react';
import { LayoutGroup, motion } from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import type { FuzzyMatch } from './fuzzy';
import { paletteResults } from './palette-results';
import { PaletteWhyLine, type PaletteWhy } from './palette-why';
import { useShortcutFormat } from './key-words';

export interface PaletteItem {
  /** Unique within the palette. */
  readonly id: string;
  /** Translated. */
  readonly title: string;
  /** Translated group heading, e.g. "Go to" or "Settings". */
  readonly group: string;
  /** Translated words people might type instead ("appearance" for the theme). */
  readonly keywords?: readonly string[];
  /** Accelerator, e.g. 'mod+k' (see shortcut.ts). Shown, and bound by useCommandShortcuts. */
  readonly shortcut?: string;
  readonly icon?: ReactNode;
  /** The bus command it runs, if any: rendered as data-command for tests and debugging. */
  readonly command?: string;
  readonly disabled?: boolean;
  /** A short fact at the row's end (a clip's length, when a chat was last used). Translated, or a person's words. */
  readonly detail?: string;
  /** Listed only once something is typed (UX4): your chats, projects, clips and templates. */
  readonly scope?: 'search';
  /** The app found it for what was typed (by name or content): listed even when the letters don't match. */
  readonly found?: boolean;
  /** Why it was found, when its name isn't what matched: one quiet line under the name. */
  readonly why?: PaletteWhy;
  /**
   * Runs the command. Resolve to `{ error }` (a translated sentence) to keep
   * the palette open and show it; anything else closes the palette.
   */
  run(): void | Promise<void | { error: string }>;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  items: readonly PaletteItem[];
  /** What is typed, as it changes: the app looks for your things by name (UX4). */
  onQueryChange?(query: string): void;
  /** The app is still looking for what was typed: a quiet line says so under the results. */
  searching?: boolean;
  className?: string;
}

function Highlighted({ text, match }: { text: string; match: FuzzyMatch | null }) {
  const chars = [...text];
  // Indices are into the folded text; only use them when folding kept every position.
  const aligned = chars.length === text.length && text.normalize('NFD').length === text.length;
  if (!match || match.indices.length === 0 || !aligned) return <>{text}</>;
  const hit = new Set(match.indices);
  return (
    <>
      {chars.map((char, i) =>
        hit.has(i) ? (
          <mark key={i} className="bg-transparent font-semibold text-ink">
            {char}
          </mark>
        ) : (
          char
        ),
      )}
    </>
  );
}

export function ShortcutKeys({ accelerator, className }: { accelerator: string; className?: string }) {
  const format = useShortcutFormat();
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center gap-0.5', className)}>
      {format.keys(accelerator).map((key, i) => (
        <kbd
          key={i}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-rule bg-chip px-1 text-2xs text-ink-2"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

/**
 * ⌘K (G28): every UI command, fuzzy-searchable, usable from the keyboard
 * alone. A combobox over a listbox (WAI-ARIA APG): focus stays in the input,
 * ↑/↓ move the active option, ↩ runs it, ⎋ closes. Radix Dialog traps focus;
 * on close, focus goes back to where it was before ⌘K.
 */
export function CommandPalette({
  open,
  onOpenChange,
  items,
  onQueryChange,
  searching = false,
  className,
}: CommandPaletteProps) {
  const { t } = useLingui();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Each opening starts a new highlight, so it doesn't glide in from where it was last time.
  const [session, setSession] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const shortcut = useShortcutFormat();
  // Radix returns focus to a Dialog.Trigger; ⌘K has none, so remember where focus was.
  const returnFocus = useRef<HTMLElement | null>(null);

  const results = useMemo(() => paletteResults(items, query), [items, query]);
  const typed = query.trim() !== '';
  const activeItem = results[active]?.item;
  const optionId = (index: number) => `${listId}-option-${index}`;

  /** The next enabled option from `from` in `step` direction (wrapping), or `from` if none. */
  const enabledFrom = (from: number, step: 1 | -1) => {
    for (let i = 0; i < results.length; i++) {
      const index = (((from + step * i) % results.length) + results.length) % results.length;
      if (!results[index]?.item.disabled) return index;
    }
    return from;
  };

  useEffect(() => onQueryChange?.(query), [onQueryChange, query]);
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setError(null);
    setSession((n) => n + 1);
  }, [open]);
  // Start on the best enabled match whenever what is typed changes. When the app's finds land under the commands, the
  // option you are on stays the one you are on.
  // Each opening starts at the top again.
  const shown = useRef({ results, query, session });
  useEffect(() => {
    const before = shown.current;
    const same = before.query === query && before.session === session;
    const was = same ? before.results[active]?.item.id : undefined;
    shown.current = { results, query, session };
    const kept = was ? results.findIndex(({ item }) => item.id === was) : -1;
    setActive(kept >= 0 ? kept : enabledFrom(0, 1));
  }, [results, session]);
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${active}"]`);
    if (el && 'scrollIntoView' in el) el.scrollIntoView({ block: 'nearest' });
  }, [active]);

  async function runItem(item: PaletteItem | undefined) {
    if (!item || item.disabled || busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await item.run();
      if (outcome && 'error' in outcome) setError(outcome.error);
      else onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const count = results.length;
    if (count === 0) return;
    const move = (to: number, step: 1 | -1) => {
      event.preventDefault();
      setActive(enabledFrom(to, step));
    };
    if (event.key === 'ArrowDown') move(active + 1, 1);
    else if (event.key === 'ArrowUp') move(active - 1, -1);
    else if (event.key === 'PageDown') move(Math.min(active + 8, count - 1), 1);
    else if (event.key === 'PageUp') move(Math.max(active - 8, 0), -1);
    else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void runItem(activeItem);
    }
  }

  const option = (item: PaletteItem, match: FuzzyMatch | null, index: number) => (
    <div
      key={item.id}
      id={optionId(index)}
      role="option"
      aria-selected={index === active}
      aria-disabled={item.disabled || undefined}
      aria-keyshortcuts={item.shortcut ? shortcut.aria(item.shortcut) : undefined}
      data-index={index}
      data-command={item.command}
      onMouseMove={() => index !== active && !item.disabled && setActive(index)}
      onClick={() => void runItem(item)}
      className={cn(
        'relative flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 type-body select-none',
        '[&>svg]:relative [&>svg]:size-4 [&>svg]:shrink-0 [&>span]:relative',
        item.disabled
          ? 'cursor-not-allowed text-ink-disabled [&>svg]:text-ink-disabled'
          : index === active
            ? 'text-ink [&>svg]:text-ink-2'
            : 'text-ink-2 [&>svg]:text-ink-3',
      )}
    >
      {index === active && !item.disabled ? (
        <motion.div
          aria-hidden
          layoutId="palette-highlight"
          data-slot="palette-highlight"
          className="absolute inset-0 rounded-md bg-hover"
          transition={{ layout: { duration: DUR.micro, ease: EASE_OUT } }}
        />
      ) : null}
      {item.icon}
      <span className="min-w-0 flex-1">
        <Highlighted text={item.title} match={match} />
        {item.why ? <PaletteWhyLine why={item.why} /> : null}
      </span>
      {item.detail ? <span className="shrink-0 type-meta text-ink-2 tabular-nums">{item.detail}</span> : null}
      {item.shortcut ? <ShortcutKeys accelerator={item.shortcut} /> : null}
    </div>
  );

  const groups = new Map<string, { item: PaletteItem; match: FuzzyMatch | null; index: number }[]>();
  results.forEach(({ item, match }, index) =>
    groups.set(item.group, [...(groups.get(item.group) ?? []), { item, match, index }]),
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=closed]:animate-fade-out" />
        <DialogPrimitive.Content
          data-slot="command-palette"
          onOpenAutoFocus={() => {
            // Runs before focus moves in, so this is still where the person was.
            returnFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocus.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          className={cn(
            'fixed top-[12vh] left-1/2 z-50 flex max-h-[76vh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col',
            'overflow-hidden rounded-2xl border border-rule-subtle bg-overlay text-ink shadow-lg',
            // Opens at once (DESIGN.md v0.2, A7): no entrance; a short fade on the way out.
            'data-[state=closed]:animate-fade-out',
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{t`Commands`}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {t`Type to filter. Use the up and down arrows to choose, Return to run, and Escape to close.`}
          </DialogPrimitive.Description>
          <div
            data-slot="palette-search"
            className={cn(
              'relative flex items-center gap-2.5 border-b border-rule-subtle px-4',
              // The focus line sits on the hairline: no ring round a field that always has focus, no layout shift.
              'after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-focus after:opacity-0',
              'has-[input:focus-visible]:after:opacity-100 window-inactive:has-[input:focus-visible]:after:opacity-0',
            )}
          >
            <Search aria-hidden className="size-4 shrink-0 text-ink-3" />
            <input
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeItem ? optionId(active) : undefined}
              aria-label={t`Search commands`}
              aria-busy={busy || undefined}
              placeholder={t`Type a command or a name`}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              className="h-12 min-w-0 flex-1 bg-transparent text-md text-ink placeholder:text-ink-3 outline-hidden"
            />
          </div>
          {error ? (
            <p
              role="alert"
              className="m-0 flex items-start gap-2 border-b border-rule-subtle px-4 py-2.5 type-body text-ink"
            >
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-strong" />
              <span className="min-w-0">{error}</span>
            </p>
          ) : null}
          {results.length === 0 && !(typed && searching) ? (
            <p role="status" className="m-0 px-4 py-8 text-center type-body text-ink-2">
              {typed ? t`Nothing matches “${query}”.` : t`There are no commands here yet.`}
            </p>
          ) : null}
          <LayoutGroup id={`${listId}-${session}-${query}`}>
            <motion.div
              ref={listRef}
              layoutScroll
              id={listId}
              role="listbox"
              aria-label={t`Commands`}
              hidden={results.length === 0}
              className="min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain p-2"
            >
              {[...groups].map(([group, entries]) => (
                <div key={group} role="group" aria-label={group} className="pb-1.5">
                  <div aria-hidden className="px-2.5 pt-1.5 pb-1 type-caption text-ink-2">
                    {group}
                  </div>
                  {entries.map(({ item, match, index }) => option(item, match, index))}
                </div>
              ))}
            </motion.div>
          </LayoutGroup>
          {typed && searching ? (
            <p
              role="status"
              data-slot="palette-searching"
              className="m-0 flex items-center gap-2 border-t border-rule-subtle px-4 py-2 type-meta text-ink-2"
            >
              <LoaderCircle
                aria-hidden
                className="size-3.5 animate-spin motion-reduce:animate-[spin_2.4s_linear_infinite]"
              />
              {t`Looking through your chats, projects, clips and templates…`}
            </p>
          ) : null}
          <div
            aria-hidden
            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule-subtle px-4 py-2 type-meta text-ink-2"
          >
            <span className="flex items-center gap-1.5">
              <ShortcutKeys accelerator="arrowup" />
              <ShortcutKeys accelerator="arrowdown" />
              {t`to choose`}
            </span>
            <span className="flex items-center gap-1.5">
              <ShortcutKeys accelerator="enter" />
              {t`to run`}
            </span>
            <span className="flex items-center gap-1.5">
              <ShortcutKeys accelerator="escape" />
              {t`to close`}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
