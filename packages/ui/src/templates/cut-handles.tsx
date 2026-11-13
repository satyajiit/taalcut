// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the cuts on the review's strip (BRK1-REV) · system: DESIGN.md v0.7 (rose is
 *   rhythm: slot boundaries; marigold the live choice)
 * a grip on each boundary between two slots: the pointer drags it, and it snaps to a beat it comes near (Option
 *   drags free) or to the nearest frame, never closer than a frame to the next cut. The selected slot's own cut is
 *   the keyboard's: a slider, Tab reaches it, ← → move it a frame, ⇧← ⇧→ a beat, Return moves the cut, Escape puts
 *   it back. While it moves, a label over it says the new time and its beat, and the reel shows that frame
 * states: default (a hairline, the grip shows on hover) · hover (the rose grip) · focus (the base ring on the grip,
 *   and the keys' hint) · dragging (the marigold line and the time label) · unsure (BRK1 §1: a dashed warning mark
 *   over the cut) · disabled (read-only: no grips) · loading: n/a (the strip waits for the version) · error: the
 *   panel's line
 * motion: none; the line follows the hand
 */
import { useLingui } from '@lingui/react/macro';
import type { Id, Template } from '@taalcut/core';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '#lib/cn';
import { cutRange, nudgeCut, placeCut, type CutPlace } from './cut-math';
import { toSeconds } from './slot-words';
import { useShortcutFormat } from '../palette/key-words';

/** A selected cut's keys: a frame, a beat (with Shift), keep, put back. */
const CUT_KEYS = ['left', 'right', 'shift+left', 'shift+right', 'enter', 'escape'] as const;

export interface CutHandlesProps {
  template: Template;
  /** The selected slot: its cut is the keyboard's. */
  selected: number;
  /** Slots whose cut Taalcut isn't sure of. */
  unsure: ReadonlySet<Id<'TemplateSlot'>>;
  /** The live place while a cut moves (the reel seeks to it), then null. */
  onPreview: (seconds: number | null) => void;
  /** A cut let go somewhere new. */
  onMove: (slotId: Id<'TemplateSlot'>, place: CutPlace) => void;
  disabled?: boolean;
}

interface Moving {
  readonly index: number;
  readonly place: CutPlace;
  readonly by: 'pointer' | 'keys';
}

export function CutHandles({
  template,
  selected,
  unsure,
  onPreview,
  onMove,
  disabled = false,
}: CutHandlesProps) {
  const { t, i18n } = useLingui();
  const keys = useShortcutFormat();
  const layer = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const total = toSeconds(template.duration) || 1;
  const seconds = (value: number) =>
    i18n.number(value, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'narrow',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  // A new version settles any move the keys left pending.
  useEffect(() => setMoving(null), [template.version]);

  const pxPerSecond = () => (layer.current?.clientWidth ?? 0) / total;
  const at = (event: PointerEvent) => {
    const box = layer.current?.getBoundingClientRect();
    return box ? ((event.clientX - box.left) / box.width) * total : 0;
  };

  const show = (next: Moving | null) => {
    setMoving(next);
    onPreview(next ? next.place.seconds : null);
  };

  const finish = (index: number, place: CutPlace) => {
    const slot = template.slots[index]!;
    show(null);
    if (Math.abs(place.seconds - toSeconds(slot.start)) > 1e-4) onMove(slot.id, place);
  };

  const onPointerDown = (index: number) => (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const place = placeCut(template, index, at(event), pxPerSecond(), event.altKey);
    if (place) show({ index, place, by: 'pointer' });
  };
  const onPointerMove = (index: number) => (event: PointerEvent<HTMLDivElement>) => {
    if (moving?.by !== 'pointer' || moving.index !== index) return;
    const place = placeCut(template, index, at(event), pxPerSecond(), event.altKey);
    if (place) show({ index, place, by: 'pointer' });
  };
  const onPointerUp = (index: number) => (event: PointerEvent<HTMLDivElement>) => {
    if (moving?.by !== 'pointer' || moving.index !== index) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    finish(index, moving.place);
  };

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    const slot = template.slots[index]!;
    const from = moving?.index === index ? moving.place.seconds : toSeconds(slot.start);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      const place = nudgeCut(
        template,
        index,
        from,
        event.key === 'ArrowRight' ? 1 : -1,
        event.shiftKey ? 'beat' : 'frame',
      );
      if (place) show({ index, place, by: 'keys' });
    } else if (event.key === 'Enter' && moving?.index === index) {
      event.preventDefault();
      event.stopPropagation();
      finish(index, moving.place);
    } else if (event.key === 'Escape' && moving?.index === index) {
      event.preventDefault();
      event.stopPropagation();
      show(null);
    }
  };

  if (disabled) return null;
  return (
    <div ref={layer} data-slot="cut-handles" className="pointer-events-none absolute inset-0">
      {template.slots.slice(1).map((slot, i) => {
        const index = i + 1;
        const range = cutRange(template, index);
        if (!range) return null;
        const live = moving?.index === index ? moving.place : null;
        const place = live?.seconds ?? toSeconds(slot.start);
        const keyboard = index === selected;
        const number = i18n.number(index + 1);
        const time = seconds(place);
        const beat = live?.beat ? i18n.number(live.beat) : null;
        const doubted = unsure.has(slot.id);
        return (
          <div
            key={slot.id}
            data-slot="cut-handle"
            data-cut-index={index}
            data-moving={moving?.index === index ? moving.by : undefined}
            data-unsure={doubted || undefined}
            // Only the selected slot's cut is the keyboard's (one tab stop); the others are the pointer's.
            {...(keyboard
              ? {
                  role: 'slider',
                  tabIndex: 0,
                  'aria-label': t`Cut before slot ${number}`,
                  'aria-valuemin': range.min,
                  'aria-valuemax': range.max,
                  'aria-valuenow': place,
                  'aria-valuetext': beat ? t`${time}, on beat ${beat}` : time,
                  'aria-keyshortcuts': CUT_KEYS.map(keys.aria).join(' '),
                }
              : { 'aria-hidden': true })}
            onPointerDown={onPointerDown(index)}
            onPointerMove={onPointerMove(index)}
            onPointerUp={onPointerUp(index)}
            onPointerCancel={() => show(null)}
            onKeyDown={onKeyDown(index)}
            onBlur={() => {
              if (moving?.by === 'keys' && moving.index === index) finish(index, moving.place);
            }}
            className="group/cut pointer-events-auto absolute top-0 bottom-0 z-2 flex w-3 -translate-x-1/2 cursor-ew-resize touch-none justify-center rounded-sm outline-offset-0"
            style={{ left: `${(place / total) * 100}%` }}
          >
            <span
              aria-hidden
              className={cn(
                'h-full w-0.5 rounded-pill transition-colors duration-(--dur-micro) ease-(--ease-out)',
                live
                  ? 'bg-playhead-strong'
                  : 'bg-transparent group-hover/cut:bg-beat-strong group-focus-visible/cut:bg-beat-strong',
              )}
            />
            {doubted && !live ? (
              <span
                aria-hidden
                data-slot="cut-unsure"
                className="absolute -top-1 size-2.5 rounded-pill border-2 border-dashed border-warning-strong bg-raised"
              />
            ) : null}
            {live ? (
              <span
                aria-hidden
                data-slot="cut-time"
                className="absolute -top-7 rounded-md bg-tooltip px-1.5 py-0.5 type-caption whitespace-nowrap text-on-tooltip tabular-nums"
              >
                {beat ? t`${time} · beat ${beat}` : time}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
