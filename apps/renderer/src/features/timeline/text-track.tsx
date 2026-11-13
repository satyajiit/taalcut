// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: text track (T1) · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * the words on screen as quiet pills at their times (the reference's or yours: shown as written, never translated)
 * states: default · hover (hover surface) · focus (the base ring on the roving pill) · active (pressed) · selected
 *   (a marigold ring inside) · editing (double-click or Return: an inline field; Return saves as
 *   timeline.editText, Escape puts it back) · disabled/loading: n/a · error (the editor's line) · success: the
 *   new words, silently · empty (no words and no captions: one compact caption recipe, sticky at the left)
 * pre-emit critique: P4 H4 E4 S4 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import type { TimelineItemId } from '@taalcut/core';
import { cn, UserContent } from '@taalcut/ui';
import { useRef, useState, type KeyboardEvent } from 'react';
import { EmptyRecipes } from '../recipes/empty-recipes';
import { useRecipeContext } from '../recipes/use-recipes';
import { useEditorContext } from './editor-context';
import { InlineTextEditor } from './inline-text-editor';
import type { TextView, TimelineModel } from './model';
import { TimelineTrimHandles } from './timeline-trim-handles';
import type { Edits } from './use-edits';
import { useTextTimingDrag } from './use-text-timing-drag';

export interface TextTrackProps {
  model: TimelineModel;
  pxPerFrame: number;
  selectedId: TimelineItemId | null;
  onSelect: (itemId: TimelineItemId | null) => void;
  edits: Edits;
}

export function TextTrack({ model, pxPerFrame, selectedId, onSelect, edits }: TextTrackProps) {
  const { t } = useLingui();
  const [editing, setEditing] = useState<TimelineItemId | null>(null);
  const items = useRef(new Map<string, HTMLDivElement>());
  const texts = model.texts;
  const tracks = [...new Set(texts.map((text) => text.trackId))];
  const tabStop = selectedId ?? texts[0]?.item.id ?? null;
  const editor = useEditorContext();
  const timing = useTextTimingDrag(model, pxPerFrame, edits, editor?.scroller);

  const focusItem = (id: TimelineItemId) => {
    onSelect(id);
    requestAnimationFrame(() => items.current.get(id)?.focus());
  };

  const onKeyDown = (text: TextView, event: KeyboardEvent<HTMLDivElement>) => {
    const index = texts.indexOf(text);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (event.shiftKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      const next = texts[index + (event.key === 'ArrowLeft' ? -1 : 1)];
      if (next) focusItem(next.item.id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (!edits.pending) setEditing(text.item.id);
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      onSelect(null);
    }
  };

  const close = (text: TextView) => {
    setEditing(null);
    requestAnimationFrame(() => items.current.get(text.item.id)?.focus());
  };

  // No words on screen and no captions yet: a caption starter where they would sit, kept in view while you scroll.
  if (texts.length === 0 && editor?.timeline.captions === null)
    return (
      <div data-slot="text-track" className="relative flex h-7 items-center">
        <CaptionStarter />
      </div>
    );

  return (
    <div
      role="listbox"
      aria-label={t`Text on screen`}
      aria-orientation="horizontal"
      data-slot="text-track"
      className="relative"
      style={{ height: Math.max(1, tracks.length) * 28 }}
    >
      {texts.map((text) => {
        const at = timing.drag?.text.item.id === text.item.id ? timing.drag.to : text;
        const left = at.start * pxPerFrame;
        const width = Math.max(24, (at.end - at.start) * pxPerFrame - 2);
        const top = tracks.indexOf(text.trackId) * 28;
        const selected = text.item.id === selectedId;
        if (editing === text.item.id)
          return (
            <InlineTextEditor
              key={text.item.id}
              words={text.item.text}
              paused={edits.pending}
              style={{ left, top, width: Math.max(160, width) }}
              onSave={(words) => edits.editText(text.item.id, words)}
              onClose={() => close(text)}
            />
          );
        return (
          <div
            key={text.item.id}
            ref={(el) => {
              if (el) items.current.set(text.item.id, el);
              else items.current.delete(text.item.id);
            }}
            role="option"
            aria-selected={selected}
            tabIndex={text.item.id === tabStop ? 0 : -1}
            data-slot="timeline-text"
            data-text-id={text.item.id}
            data-item-id={text.item.id}
            className={cn(
              'group absolute flex h-5 cursor-default touch-none items-center overflow-hidden rounded-sm border border-rule bg-raised px-3 text-2xs font-medium whitespace-nowrap text-ink-2 transition-colors duration-(--dur-micro) ease-(--ease-out) select-none hover:bg-hover active:bg-pressed',
              selected && 'border-primary-strong bg-selected text-ink hover:bg-selected',
            )}
            style={{ left, width, top: top + 4 }}
            onPointerDown={(event) => {
              onSelect(text.item.id);
              timing.start(text, event);
            }}
            onPointerMove={timing.move}
            onPointerUp={timing.finish}
            onPointerCancel={timing.cancel}
            onLostPointerCapture={timing.cancel}
            onDoubleClick={(event) => {
              if (edits.pending || (event.target as HTMLElement).closest('[data-trim-edge]')) return;
              event.stopPropagation();
              onSelect(text.item.id);
              setEditing(text.item.id);
            }}
            onFocus={() => {
              if (!selected) onSelect(text.item.id);
            }}
            onKeyDown={(event) => onKeyDown(text, event)}
          >
            <TimelineTrimHandles
              selected={selected}
              active={timing.drag?.text.item.id === text.item.id ? timing.drag.edge : null}
            />
            <UserContent className="truncate whitespace-nowrap">{text.item.text}</UserContent>
          </div>
        );
      })}
    </div>
  );
}

function CaptionStarter() {
  return (
    <EmptyRecipes context={useRecipeContext()} category="captions" size="compact" className="sticky left-2" />
  );
}
