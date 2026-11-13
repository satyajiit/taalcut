// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: template list (windowed listbox) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * every template in the view in one scrolling list, however many: only the rows on screen and three either side
 *   exist, placed with transforms in a box as tall as all of them, so the scrollbar is honest and scrolling stays on
 *   the compositor (React renders only when a row enters or leaves)
 * keyboard: one row in the tab order; ↑ ↓, Page Up/Down, Home and End move (Shift extends the selection); Space
 *   selects; ⌘A selects all; Escape lets go; Enter opens
 * states: the rows' (template-row.tsx); motion: none of its own
 */
import { useLingui } from '@lingui/react/macro';
import type { TemplateId, TemplateSearchHit, TemplateSummary } from '@taalcut/core';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { moveIndex, visibleRows, type RowRange } from '../../library/virtual-grid';
import { ROW_HEIGHT, TemplateRow } from '../template-row';
import type { Selection } from './selection';

export interface TemplateListProps {
  readonly items: readonly TemplateSummary[];
  readonly selection: Selection;
  readonly onSelect: (next: { kind: 'toggle' | 'extend'; id: TemplateId } | { kind: 'all' | 'none' }) => void;
  readonly onOpen: (id: TemplateId) => void;
  /** Folder names by id; the open folder's own is left out. */
  readonly folderNames: ReadonlyMap<string, string>;
  readonly isStale: (summary: TemplateSummary) => boolean;
  readonly now: number;
  readonly label: string;
  /** The search words these templates answer (data-answers, so a test can time the search). */
  readonly answers: string;
  /** While the list is a search's answer (LRN1-FIX): each template's hit, so its row says what matched. */
  readonly matches?: ReadonlyMap<TemplateId, TemplateSearchHit> | undefined;
}

// eslint-disable-next-line lingui/no-unlocalized-strings -- KeyboardEvent.key values, not words
const MOVES = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
const sameRange = (a: RowRange, b: RowRange) => a.start === b.start && a.end === b.end;

/** The scroll container the list sits in: the shell's main area, or the window. */
function scrollerOf(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>('[data-slot=scroll-area]') ?? document.documentElement;
}

export function TemplateList({
  items,
  selection,
  onSelect,
  onOpen,
  folderNames,
  isStale,
  now,
  label,
  answers,
  matches,
}: TemplateListProps) {
  const { t } = useLingui();
  const list = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<RowRange>({ start: 0, end: 12 });
  const [active, setActive] = useState(0);
  const focusOnRender = useRef(false);
  const count = items.length;
  const current = Math.min(active, Math.max(0, count - 1));

  const measure = useCallback(() => {
    const element = list.current;
    if (!element) return;
    const scroller = scrollerOf(element);
    const offset = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const next = visibleRows(-offset, scroller.clientHeight, 0, ROW_HEIGHT, count);
    setRange((prev) => (sameRange(prev, next) ? prev : next));
  }, [count]);

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const scroller = scrollerOf(element);
    measure();
    const target = scroller === document.documentElement ? window : scroller;
    target.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      target.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  useEffect(() => {
    if (!focusOnRender.current) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    if (row) {
      row.focus({ preventScroll: true });
      focusOnRender.current = false;
    }
  });

  /** Brings row `index` into view, then focuses it once it is drawn. */
  const moveTo = (index: number) => {
    const element = list.current;
    if (!element) return;
    const scroller = scrollerOf(element);
    const top =
      element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const rowTop = top + index * ROW_HEIGHT;
    if (rowTop < scroller.scrollTop) scroller.scrollTop = rowTop - 8;
    else if (rowTop + ROW_HEIGHT > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = rowTop + ROW_HEIGHT - scroller.clientHeight;
    focusOnRender.current = true;
    setActive(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = list.current;
    const item = items[current];
    if (!element || !item) return;
    if (MOVES.has(event.key)) {
      const pageRows = Math.max(1, Math.floor(scrollerOf(element).clientHeight / ROW_HEIGHT));
      const next = moveIndex(event.key, current, count, 1, pageRows);
      const target = next === null ? undefined : items[next];
      if (next === null || !target) return;
      event.preventDefault();
      if (event.shiftKey) onSelect({ kind: 'extend', id: target.id });
      moveTo(next);
    } else if (event.key === ' ') {
      event.preventDefault();
      onSelect({ kind: 'toggle', id: item.id });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(item.id);
    } else if (event.key.toLowerCase() === 'a' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSelect({ kind: 'all' });
    } else if (event.key === 'Escape' && selection.ids.size > 0) {
      event.preventDefault();
      onSelect({ kind: 'none' });
    }
  };

  const onPick = useCallback(
    (index: number, how: 'open' | 'toggle' | 'extend') => {
      const item = items[index];
      if (!item) return;
      setActive(index);
      if (how === 'open') onOpen(item.id);
      else onSelect({ kind: how, id: item.id });
    },
    [items, onOpen, onSelect],
  );

  const rows = useMemo(() => {
    const out = [];
    const selecting = selection.ids.size > 0;
    const last = Math.min(count, range.end);
    // The active row stays tabbable while drawn; otherwise the first drawn row takes the tab stop.
    const tabStop = current >= range.start && current < last ? current : range.start;
    for (let index = range.start; index < last; index += 1) {
      const summary = items[index];
      if (!summary) continue;
      out.push(
        <TemplateRow
          key={summary.id}
          summary={summary}
          index={index}
          total={count}
          selected={selection.ids.has(summary.id)}
          selecting={selecting}
          tabbable={index === tabStop}
          folder={summary.folderId ? (folderNames.get(summary.folderId) ?? null) : null}
          stale={isStale(summary)}
          match={matches?.get(summary.id)}
          now={now}
          style={{ transform: `translate3d(0,${index * ROW_HEIGHT}px,0)` }}
          onPick={onPick}
        />,
      );
    }
    return out;
  }, [range, items, count, current, selection, folderNames, isStale, matches, now, onPick]);

  return (
    <div
      ref={list}
      role="listbox"
      aria-multiselectable="true"
      aria-label={label}
      aria-description={t`Space selects, Shift with an arrow selects a run, Command A selects all, Enter opens.`}
      data-slot="template-list"
      data-answers={answers}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const index = Number(event.target.closest<HTMLElement>('[data-index]')?.dataset.index);
        if (Number.isInteger(index)) setActive(index);
      }}
      className="@container relative"
      style={{ height: Math.max(0, count * ROW_HEIGHT - 4) }}
    >
      {rows}
    </div>
  );
}
