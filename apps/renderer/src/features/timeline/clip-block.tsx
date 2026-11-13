// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: timeline clip · genre: atmospheric studio app (the timeline) · system: DESIGN.md v0.3
 * a neutral block on the sunken bed: a label strip ("3 · Close-up") over a filmstrip of its shot; the AI's pick
 *   has a violet bottom edge, your swap a teal wash and edge (and "You" in words), a locked clip a lock; edges are
 *   data marks on clips only (DESIGN.md: never a container's stripe)
 * states: default · hover (the label strip takes the hover surface; trim grips show) · focus (the base ring,
 *   instant, on the roving clip) · active (pressed: grabbing to reorder) · selected (a 2 px marigold ring inside,
 *   the selection wash on the strip) · dragging (lifted with shadow-md above its neighbours) · disabled: n/a ·
 *   loading (no picture yet: the viewer grey) · error/success: the editor's line under the transport
 * pre-emit critique: P5 H5 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { cn, SHOT_TYPE_LABELS } from '@taalcut/ui';
import { Lock } from 'lucide-react';
import type { KeyboardEvent, PointerEvent, Ref } from 'react';
import type { ClipView } from './model';
import type { AiEditMark } from './ai-edit-marks';

export interface ClipBlockProps {
  view: ClipView;
  aiMark?: AiEditMark | undefined;
  width: number;
  /** The shot's picture for the filmstrip; null keeps the viewer grey. */
  picture: string | null;
  selected: boolean;
  /** The roving tab stop of the clip list. */
  tabStop: boolean;
  dragging: boolean;
  /** Which edges can be trimmed by dragging. */
  edges: { readonly start: boolean; readonly end: boolean };
  onBodyPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onEdgePointerDown: (edge: 'start' | 'end', event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  ref?: Ref<HTMLDivElement>;
}

export function ClipBlock({
  view,
  aiMark,
  width,
  picture,
  selected,
  tabStop,
  dragging,
  edges,
  onBodyPointerDown,
  onEdgePointerDown,
  onKeyDown,
  onFocus,
  ref,
}: ClipBlockProps) {
  const { t, i18n } = useLingui();
  const shotType = view.slot?.intent.shotType;
  const kind = shotType ? i18n._(SHOT_TYPE_LABELS[shotType]) : null;
  const n = i18n.number(view.number);
  const locked = view.item.locked;
  const chosen =
    view.chosenBy === 'you' ? t`You changed this` : view.chosenBy === 'ai' ? t`Taalcut picked this` : null;
  const name = [kind ? t`Clip ${n}, ${kind}` : t`Clip ${n}`, chosen, locked ? t`Locked` : null]
    .filter(Boolean)
    .join('. ');
  const narrow = width < 44;
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      aria-label={name}
      tabIndex={tabStop ? 0 : -1}
      data-slot="timeline-clip"
      data-clip-id={view.item.id}
      data-flip-key={view.item.id}
      data-chosen-by={view.chosenBy ?? undefined}
      data-selected={selected || undefined}
      data-ai-edit={aiMark}
      data-dragging={dragging || undefined}
      className={cn(
        // Each clip on its own layer: a drag or a reorder moves it without painting its filmstrip again.
        'group/clip relative h-full shrink-0 cursor-grab touch-none overflow-hidden rounded-clip border border-rule-subtle bg-raised will-change-transform select-none',
        'active:cursor-grabbing data-[dragging]:z-10 data-[dragging]:cursor-grabbing data-[dragging]:shadow-md',
        dragging && 'z-10 shadow-md',
        aiMark && 'border-ai-strong',
      )}
      style={{ width }}
      onPointerDown={onBodyPointerDown}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      <div
        className={cn(
          'flex h-4 items-center gap-1 px-1.5 text-2xs leading-none font-medium whitespace-nowrap text-ink-2 transition-colors duration-(--dur-micro) ease-(--ease-out) group-hover/clip:bg-hover',
          view.chosenBy === 'you' && 'bg-you-soft text-you-strong group-hover/clip:bg-you-soft',
          selected && 'bg-selected text-ink group-hover/clip:bg-selected',
        )}
      >
        {/* The dot is drawn, not text, and a space parts the words, so what it shows ("3 Close-up") is in its name (2.5.3). */}
        <span className="tabular-nums">{n}</span>{' '}
        {kind && !narrow ? (
          <span className="min-w-0 truncate text-ink-3 before:content-['·_']">{kind}</span>
        ) : null}
        {locked ? <Lock aria-hidden className="ml-auto size-2.5 shrink-0" /> : null}
      </div>
      <div
        aria-hidden
        className="tc-viewer h-[calc(100%-1rem)] bg-repeat-x"
        style={
          picture
            ? {
                backgroundImage: `url("${picture}")`,
                backgroundSize: 'auto 100%',
                backgroundPosition: 'left center',
              }
            : undefined
        }
      />
      {aiMark ? (
        <span className="pointer-events-none absolute bottom-1 left-1 rounded-sm bg-ai-soft px-1 text-2xs text-ai-strong">
          {aiMark === 'changed' ? t`AI changed` : t`AI target`}
        </span>
      ) : null}
      {view.chosenBy ? (
        <span
          aria-hidden
          className={cn(
            'absolute inset-x-0 bottom-0 h-0.5',
            view.chosenBy === 'you' ? 'bg-you-strong' : 'bg-ai-strong',
          )}
        />
      ) : null}
      {selected ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-clip ring-2 ring-primary-strong ring-inset"
        />
      ) : null}
      {(['start', 'end'] as const).map((edge) =>
        edges[edge] ? (
          <div
            key={edge}
            aria-hidden
            data-slot="trim-handle"
            data-edge={edge}
            className={cn(
              'absolute inset-y-0 z-10 flex w-2 cursor-ew-resize items-center justify-center opacity-0 transition-opacity duration-(--dur-micro) ease-(--ease-out) group-hover/clip:opacity-100',
              edge === 'start' ? 'left-0' : 'right-0',
              selected && 'opacity-100',
            )}
            onPointerDown={(event) => onEdgePointerDown(edge, event)}
          >
            <span className="block h-6 w-1 rounded-pill bg-primary-strong" />
          </div>
        ) : null,
      )}
    </div>
  );
}
