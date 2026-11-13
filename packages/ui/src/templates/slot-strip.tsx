// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: slot strip · system: DESIGN.md v0.7 (Timeline: slots are blocks on the sunken
 *   bed; UX3: the hook, the peak and the ending carry their role's data mark; BRK1: the reel's frames in the blocks)
 * one block per slot, as wide as its share of the reel, so it sits under its stretch of the waveform; a 3 px mark
 *   along the top of the hook (coral), the peak (orchid) and the ending (sky), its role in the block's name too.
 *   With `frames` (the review) each block shows its slot's frame from the contact sheet at the reel's own shape,
 *   repeated across the block like a filmstrip, and its number and marks sit on small raised chips over it
 * states: default (raised block, rule hairline) · hover (hover surface, or a strong edge over frames; its sound
 *   lights up) · focus (base ring on the block, roving: arrows, Home, End) · active (pressed surface) · selected
 *   (selection wash or the strong marigold edge) · to check (BRK1: the dashed warning circle, and "to check" in its
 *   name) · approved by you (teal check, and the word in its name) · disabled (read-only: still selectable, no edit
 *   keys) · loading (the breakdown's stages, in the card) · error/success: the panel's line
 * motion: after a merge, a drop or a split the blocks slide to their new places (shared layout, 220 ms, ease-out,
 *   transform); reduced motion: they take them at once
 */
import { useLingui } from '@lingui/react/macro';
import type { Id, Template } from '@taalcut/core';
import { Check } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { ROLE_KIND } from './kinds';
import { REVIEW_ICONS } from './review-icons';
import { sheetTileStyle } from './sheet-tile';
import { ROLE_LABELS, SHOT_TYPE_LABELS, toSeconds } from './slot-words';

export interface SlotStripProps {
  template: Template;
  selected: number;
  onSelect: (index: number) => void;
  onHover?: (index: number | null) => void;
  /** Return on a block. */
  onRename?: (index: number) => void;
  /** Delete or Backspace on a block. */
  onDrop?: (index: number) => void;
  /** BRK1: the contact sheet's URL, to show each slot's frame in its block; undefined keeps the blocks plain. */
  frames?: string | null;
  /** BRK1: slots with something left to check. */
  toCheck?: ReadonlySet<Id<'TemplateSlot'>>;
  className?: string;
}

/** A slot's frame, laid across its block at the reel's own shape as many times as fit: a filmstrip. */
function BlockFrames({ template, url, index }: { template: Template; url: string | null; index: number }) {
  const box = useRef<HTMLSpanElement>(null);
  // Its own box, inside the tile's border (which thickens when the slot is selected).
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const sheet = template.contactSheet;
  const slot = template.slots[index]!;
  const tile = sheet ? (slot.frame ?? sheet.frames.findIndex((frame) => frame.slotId === slot.id)) : -1;
  const { width, height } = size;
  const tileWidth = sheet ? Math.max(8, (height * sheet.tile.width) / sheet.tile.height) : 0;
  const count = sheet && tile >= 0 && width > 0 && height > 0 ? Math.ceil(width / tileWidth) : 0;
  // Whole frames, and the last one cut to what is left, so the frames fill the block exactly.
  const last = Math.max(0, Math.floor(width - (count - 1) * tileWidth));
  return (
    <span
      ref={box}
      aria-hidden
      data-slot="block-frames"
      className="absolute inset-0 flex overflow-hidden bg-viewer"
    >
      {sheet
        ? Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className="block shrink-0 bg-no-repeat"
              style={{
                ...sheetTileStyle(sheet, url, tileWidth, height, tile),
                ...(i === count - 1 ? { width: last } : {}),
              }}
            />
          ))
        : null}
    </span>
  );
}

export function SlotStrip({
  template,
  selected,
  onSelect,
  onHover,
  onRename,
  onDrop,
  frames,
  toCheck,
  className,
}: SlotStripProps) {
  const { t, i18n } = useLingui();
  const reduce = useReducedMotion();
  const strip = useRef<HTMLDivElement>(null);
  const filmstrip = frames !== undefined && template.contactSheet !== null;
  const total = toSeconds(template.duration) || 1;
  const count = template.slots.length;
  const ToCheck = REVIEW_ICONS.toCheck;

  const focusSlot = (index: number) => {
    onSelect(index);
    // The block exists already; focus it so the ring and the screen reader follow.
    strip.current?.querySelector<HTMLElement>(`[data-slot-index="${index}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: Math.min(count - 1, selected + 1),
      ArrowLeft: Math.max(0, selected - 1),
      Home: 0,
      End: count - 1,
    };
    if (event.key in keys) {
      event.preventDefault();
      focusSlot(keys[event.key]!);
    } else if (event.key === 'Enter' && onRename) {
      event.preventDefault();
      onRename(selected);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && onDrop) {
      event.preventDefault();
      onDrop(selected);
    }
  };

  return (
    <div
      ref={strip}
      role="listbox"
      aria-label={t`Slots`}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      onPointerLeave={() => onHover?.(null)}
      data-slot="slot-strip"
      data-frames={filmstrip || undefined}
      className={cn('relative h-16', className)}
    >
      {template.slots.map((slot, index) => {
        const left = (toSeconds(slot.start) / total) * 100;
        const width = (toSeconds(slot.duration) / total) * 100;
        const shot = slot.intent.shotType ? i18n._(SHOT_TYPE_LABELS[slot.intent.shotType]) : null;
        const isSelected = index === selected;
        const position = i18n.number(index + 1);
        const checking = toCheck?.has(slot.id) ?? false;
        return (
          <motion.div
            key={slot.id}
            layout={reduce ? false : 'position'}
            transition={{ duration: DUR.short, ease: EASE_OUT }}
            role="option"
            id={`slot-${slot.id}`}
            data-slot-index={index}
            data-to-check={checking || undefined}
            aria-selected={isSelected}
            // Named like a timeline clip ("Slot 3, Close-up"), the shot it shows included (2.5.3); the listbox
            // says "3 of 12" itself.
            aria-label={[
              shot ? t`Slot ${position}, ${shot}` : t`Slot ${position}`,
              slot.role === 'body' ? null : i18n._(ROLE_LABELS[slot.role]),
              checking ? t`To check` : null,
              slot.approved ? t`Approved` : null,
            ]
              .filter(Boolean)
              .join('. ')}
            tabIndex={isSelected ? 0 : -1}
            onClick={() => focusSlot(index)}
            onPointerEnter={() => onHover?.(index)}
            className="@container absolute top-0 bottom-0 cursor-pointer px-px outline-offset-1"
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            <span
              className={cn(
                'relative flex size-full min-w-0 flex-col justify-between overflow-hidden rounded-clip border p-1',
                'transition-colors duration-(--dur-micro) ease-(--ease-out)',
                filmstrip
                  ? isSelected
                    ? 'border-2 border-primary-strong'
                    : 'border-rule hover:border-rule-strong'
                  : isSelected
                    ? 'border-primary-strong bg-selected'
                    : 'border-rule bg-raised hover:bg-hover active:bg-pressed',
              )}
            >
              {filmstrip ? <BlockFrames template={template} url={frames ?? null} index={index} /> : null}
              {slot.role === 'body' ? null : (
                <span
                  aria-hidden
                  data-slot="role-mark"
                  className={cn('absolute inset-x-0 top-0 z-1 h-[3px]', ROLE_KIND[slot.role].tone.mark)}
                />
              )}
              <span className="relative flex items-center justify-between gap-0.5">
                <span
                  className={cn(
                    'text-xs font-semibold text-ink tabular-nums',
                    filmstrip && 'rounded-sm bg-raised px-1 leading-4',
                  )}
                >
                  {i18n.number(index + 1)}
                </span>
                {/* A tile too narrow for both keeps its number; its name says the rest. */}
                {checking ? (
                  <span className={cn('hidden @[2.75rem]:flex', filmstrip && 'rounded-sm bg-raised p-px')}>
                    <ToCheck aria-hidden className="size-3 shrink-0 text-warning-strong" />
                  </span>
                ) : slot.approved ? (
                  <span className={cn('hidden @[2.75rem]:flex', filmstrip && 'rounded-sm bg-raised p-px')}>
                    <Check aria-hidden className="size-3 shrink-0 text-you-strong" />
                  </span>
                ) : null}
              </span>{' '}
              {shot && !filmstrip ? (
                <span aria-hidden className="hidden text-2xs leading-3 text-ink-2 @[5.5rem]:block">
                  {shot}
                </span>
              ) : null}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}
