// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { ImportDraft, ImportItem } from '@taalcut/core';
import { cn } from '@taalcut/ui';
import { Check, Film, Folder, Image } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { moveIndex, visibleRows } from '../virtual-grid';
import { describeImportItem } from './import-item-meta';
import { ImportThumbnail } from './import-thumbnail';
import { bytes } from './import-words';
import { itemSelected, selectItems } from './selection-model';

const ROW_HEIGHT = 100;
export function ChooseItems({
  draft,
  items,
  pending,
  update,
}: {
  draft: ImportDraft;
  items: ImportItem[];
  pending: boolean;
  update: (patch: Partial<ImportDraft>) => Promise<boolean>;
}) {
  const { t, i18n } = useLingui();
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef(0);
  const [focus, setFocus] = useState(0);
  const [scroll, setScroll] = useState(0);
  const range = visibleRows(scroll, scroller.current?.clientHeight ?? 480, 0, ROW_HEIGHT, items.length);
  const choose = (index: number, shift: boolean) => {
    if (pending) return;
    void update(selectItems(draft, items, index, anchor.current, shift));
    if (!shift) anchor.current = index;
  };
  const keyboard = (event: KeyboardEvent, index: number) => {
    const next = moveIndex(event.key, index, items.length, 1, 4);
    if (next === null) return;
    event.preventDefault();
    setFocus(next);
    if (event.shiftKey) choose(next, true);
    const viewport = scroller.current;
    if (viewport) {
      if (next * ROW_HEIGHT < viewport.scrollTop) viewport.scrollTop = next * ROW_HEIGHT;
      else if ((next + 1) * ROW_HEIGHT > viewport.scrollTop + viewport.clientHeight)
        viewport.scrollTop = (next + 1) * ROW_HEIGHT - viewport.clientHeight;
      requestAnimationFrame(() =>
        viewport.querySelector<HTMLButtonElement>(`[data-item-index="${next}"]`)?.focus(),
      );
    }
  };
  const date = (item: ImportItem) =>
    item.capturedAt === null
      ? t`Date unknown`
      : new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'medium' }).format(item.capturedAt);
  return (
    <div
      ref={scroller}
      role="listbox"
      aria-label={t`Footage to import`}
      aria-multiselectable
      className="scrollbar-thin max-h-[min(24rem,42dvh)] min-h-40 overflow-auto overscroll-contain rounded-xl border border-rule-subtle bg-canvas p-1.5 lg:max-h-[min(34rem,62dvh)]"
      onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
    >
      <div style={{ height: items.length * ROW_HEIGHT, position: 'relative' }}>
        {items.slice(range.start, range.end).map((item, offset) => {
          const index = range.start + offset;
          const selected = itemSelected(draft, item);
          const meta = describeImportItem(item);
          const prev = index > 0 ? items[index - 1] : undefined;
          const prevMeta = prev ? describeImportItem(prev) : null;
          const day = date(item);
          const showHeader =
            index === 0 || day !== date(prev!) || meta.directory !== prevMeta?.directory;
          return (
            <div
              key={item.id}
              style={{ position: 'absolute', top: index * ROW_HEIGHT, height: ROW_HEIGHT, insetInline: 0 }}
            >
              <div className="flex h-6 items-center gap-2 px-3 type-caption font-medium text-ink-2">
                {showHeader ? (
                  <>
                    {meta.directory ? (
                      <>
                        <span className="inline-flex items-center gap-1 text-ink" translate="no">
                          <Folder aria-hidden className="size-3 text-ink-2" />
                          {meta.directory}
                        </span>
                        <span aria-hidden>·</span>
                      </>
                    ) : null}
                    <span>{day}</span>
                  </>
                ) : null}
              </div>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={pending}
                aria-setsize={items.length}
                aria-posinset={index + 1}
                data-item-index={index}
                tabIndex={index === focus ? 0 : -1}
                onFocus={() => setFocus(index)}
                onKeyDown={(event) => keyboard(event, index)}
                onClick={(event) => choose(index, event.shiftKey)}
                className={cn(
                  'flex h-18 w-full items-center gap-3.5 rounded-lg border border-transparent px-3 text-start transition-colors duration-(--dur-micro) hover:bg-hover focus-visible:outline-2 focus-visible:outline-focus',
                  selected && 'border-rule-strong bg-selected',
                )}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-sm border transition-colors duration-(--dur-micro)',
                    selected
                      ? 'border-primary-strong bg-inverse text-on-inverse'
                      : 'border-rule-strong bg-canvas',
                  )}
                >
                  {selected ? <Check aria-hidden className="size-3" /> : null}
                </span>
                <ImportThumbnail url={item.thumbnailUrl} kind={meta.kind} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate type-label text-ink" translate="no" title={item.name}>
                      {meta.fileName}
                    </span>
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1 rounded-pill px-1.5 py-0.25 type-caption',
                        meta.kind === 'video' ? 'bg-teal-soft text-teal-strong' : 'bg-chip text-ink-2',
                      )}
                    >
                      {meta.kind === 'video' ? (
                        <Film aria-hidden className="size-2.5" />
                      ) : (
                        <Image aria-hidden className="size-2.5" />
                      )}
                      {meta.kind === 'video' ? t`Video` : t`Photo`}
                    </span>
                    {meta.extension ? (
                      <span
                        className="shrink-0 rounded-sm bg-well px-1.5 py-0.25 font-mono type-caption text-ink-2"
                        translate="no"
                      >
                        {meta.extension}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 type-meta text-ink-2 tabular-nums">
                    {meta.directory ? (
                      <>
                        <span
                          className="inline-flex items-center gap-1 rounded-sm bg-well px-1.5 py-0.25 type-caption text-ink"
                          translate="no"
                        >
                          <Folder aria-hidden className="size-2.5 text-ink-2" />
                          {meta.directory}
                        </span>
                        <span aria-hidden>·</span>
                      </>
                    ) : null}
                    <span
                      className={cn(
                        'rounded-sm px-1.5 py-0.25 type-caption',
                        item.duplicate ? 'bg-chip text-ink-2' : 'bg-well text-ink',
                      )}
                    >
                      {item.duplicate
                        ? t`Already imported`
                        : item.supported
                          ? t`Ready to import`
                          : t`Save originals`}
                    </span>
                    <span aria-hidden>·</span>
                    <span>
                      {item.sizeBytes === null ? t`Size unknown` : bytes(item.sizeBytes, i18n.locale)}
                    </span>
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
