// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the audio feed's tabs · mode: Operate · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 (Segmented;
 *   Motion › Glide)
 * The shelf's tabs (the app has Trending, For You, Original audio, Royalty-free and Saved; the showcase shows the
 *   ones its story needs), as a segmented pill on the sunken well, its raised thumb gliding under the chosen tab.
 *   Real tabs: Tab reaches the chosen one, the arrows move and choose, Home and End jump; each controls the list
 *   below. On a narrow window the pill wraps onto a second line instead of
 *   scrolling sideways.
 * states: default · hover (ink) · focus (base ring, instant) · active (pressed surface) · chosen (the thumb,
 *   aria-selected) · Saved carries its count
 * motion: the thumb glides (--dur-short, ease-out); reduced motion: it moves at once */

import { motion, useReducedMotion } from 'motion/react';
import { useId, useRef, type KeyboardEvent } from 'react';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { FEED_TABS, type FeedTab } from './sounds';

/** A tab's element id, so the list can be labelled by the chosen tab. */
export function tabId(panel: string, tab: FeedTab): string {
  return `${panel}-${tab.toLowerCase().replace(/[^a-z]+/g, '-')}`;
}

export function FeedTabs({
  value,
  onChange,
  panel,
  saved,
  tabs = FEED_TABS,
  className,
}: {
  readonly value: FeedTab;
  readonly onChange: (tab: FeedTab) => void;
  /** The id of the list the tabs control. */
  readonly panel: string;
  /** How many sounds are saved, shown on Saved. */
  readonly saved: number;
  /** The tabs on show, in the app's order. */
  readonly tabs?: readonly FeedTab[];
  readonly className?: string;
}) {
  const thumb = useId();
  const reduce = useReducedMotion();
  const list = useRef<HTMLDivElement>(null);
  const choose = (tab: FeedTab) => {
    onChange(tab);
    list.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.indexOf(value);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const target =
      step !== 0
        ? tabs[(at + step + tabs.length) % tabs.length]
        : event.key === 'Home'
          ? tabs[0]
          : event.key === 'End'
            ? tabs[tabs.length - 1]
            : undefined;
    if (!target) return;
    event.preventDefault();
    choose(target);
  };
  return (
    <div
      ref={list}
      role="tablist"
      aria-label="Audio feed"
      onKeyDown={onKeyDown}
      className={cn('flex w-fit max-w-full flex-wrap gap-0.5 rounded-2xl bg-sunken p-0.5', className)}
    >
      {tabs.map((tab) => {
        const chosen = tab === value;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            id={tabId(panel, tab)}
            data-tab={tab}
            aria-selected={chosen}
            aria-controls={panel}
            tabIndex={chosen ? 0 : -1}
            onClick={() => choose(tab)}
            className={cn(
              'relative inline-flex h-8 items-center justify-center gap-1.5 rounded-pill px-3 type-label-sm whitespace-nowrap select-none',
              'transition-colors duration-(--dur-micro) ease-(--ease-out)',
              chosen ? 'text-ink' : 'text-ink-2 hover:text-ink active:bg-pressed',
            )}
          >
            {chosen ? (
              <motion.span
                aria-hidden
                layoutId={thumb}
                transition={reduce ? { duration: 0 } : { duration: DUR.short, ease: EASE_OUT }}
                className="absolute inset-0 rounded-pill border border-rule-strong bg-raised shadow-xs"
              />
            ) : null}
            <span className="relative">{tab}</span>
            {tab === 'Saved' && saved > 0 ? (
              <span className="relative rounded-pill bg-rose-soft px-1.5 type-caption font-semibold text-rose-strong tabular-nums">
                {saved}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
