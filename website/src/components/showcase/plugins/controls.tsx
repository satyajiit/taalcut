// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Settings' switch row, check row and view tabs · mode: Operate · system: WEB2 Remix Vernacular
 *   (DESIGN.md v0.7.2 Switch, Checkbox, Segmented; teal is your choice)
 * SwitchRow: a setting's words with its switch (role switch; the words name and describe it). CheckRow: a kind of
 *   access, a real checkbox with its words, the whole row its hit area. ViewTabs: a page's views as tabs on the
 *   sunken well, each led by its glyph, the raised thumb gliding under the open one; the arrows, Home and End move.
 * states: switch: off · on (teal, the thumb across) · hover · focus (base ring) · active · disabled (said why in the
 *   row's words) · checkbox: unchecked · checked (teal, the drawn tick) · hover (the row washes) · focus (the box's
 *   ring) · disabled · tabs: default · hover · focus · active · open (aria-selected, the thumb)
 * motion: the switch's thumb and the tabs' thumb glide by transform (--dur-short); reduced motion: at once */

import { Check, type LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { type KeyboardEvent, type ReactNode, useId, useRef } from 'react';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';

export function SwitchRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
  className,
}: {
  readonly label: string;
  readonly description: ReactNode;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (on: boolean) => void;
  readonly className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-start justify-between gap-4 rounded-lg border border-rule-subtle bg-raised px-3.5 py-3', className)}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={`${id}-l`} className="type-label text-ink">
          {label}
        </span>
        <span id={`${id}-d`} className="max-w-prose type-meta text-ink-2">
          {description}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={`${id}-d`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-pill border p-0.5 transition-colors duration-(--dur-micro) ease-(--ease-out)',
          'disabled:cursor-not-allowed disabled:opacity-60',
          checked ? 'border-teal-strong bg-teal-strong' : 'border-rule-strong bg-control hover:bg-control-hover',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'block size-4.5 rounded-pill bg-raised shadow-xs transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  );
}

export function CheckRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (on: boolean) => void;
}) {
  return (
    <li className="border-t border-rule-subtle first:border-t-0">
      <label
        className={cn(
          'flex min-h-12 w-full items-start gap-3 px-3 py-2.5 transition-colors duration-(--dur-micro) ease-(--ease-out)',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-hover',
        )}
      >
        <span className="relative mt-0.5 inline-grid size-4.5 shrink-0 place-items-center">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            className={cn(
              'peer size-4.5 appearance-none rounded-sm border-[1.5px] transition-colors duration-(--dur-micro) ease-(--ease-out)',
              'checked:border-teal-strong checked:bg-teal-strong',
              'border-rule-strong bg-raised',
            )}
          />
          <Check
            aria-hidden
            strokeWidth={3}
            className="pointer-events-none absolute size-3 text-teal-ink opacity-0 peer-checked:opacity-100"
          />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="type-label text-ink">{label}</span>
          <span className="max-w-prose type-meta text-ink-2">{description}</span>
        </span>
      </label>
    </li>
  );
}

export interface ViewTab<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly icon: LucideIcon;
}

/** A page's views as tabs: each controls `panel`, which the open tab labels (`viewTabId`). */
export function viewTabId(panel: string, id: string): string {
  return `${panel}-${id}`;
}

export function ViewTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  panel,
}: {
  readonly label: string;
  readonly tabs: readonly ViewTab<T>[];
  readonly value: T;
  readonly onChange: (id: T) => void;
  readonly panel: string;
}) {
  const thumb = useId();
  const reduce = useReducedMotion();
  const list = useRef<HTMLDivElement>(null);
  const choose = (id: T) => {
    onChange(id);
    list.current?.querySelector<HTMLElement>(`[data-view="${id}"]`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.id === value);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const target =
      step !== 0 ? tabs[(at + step + tabs.length) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined;
    if (!target) return;
    event.preventDefault();
    choose(target.id);
  };
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex w-fit max-w-full flex-wrap gap-0.5 rounded-2xl bg-sunken p-0.5"
    >
      {tabs.map((tab) => {
        const open = tab.id === value;
        const Glyph = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={viewTabId(panel, tab.id)}
            data-view={tab.id}
            aria-selected={open}
            aria-controls={panel}
            tabIndex={open ? 0 : -1}
            onClick={() => choose(tab.id)}
            className={cn(
              'relative inline-flex h-8 items-center gap-1.5 rounded-pill px-3 type-label-sm whitespace-nowrap select-none',
              'transition-colors duration-(--dur-micro) ease-(--ease-out)',
              open ? 'text-ink' : 'text-ink-2 hover:text-ink active:bg-pressed',
            )}
          >
            {open ? (
              <motion.span
                aria-hidden
                layoutId={thumb}
                transition={reduce ? { duration: 0 } : { duration: DUR.short, ease: EASE_OUT }}
                className="absolute inset-0 rounded-pill border border-rule-strong bg-raised shadow-xs"
              />
            ) : null}
            <Glyph aria-hidden className="relative size-3.5 shrink-0" />
            <span className="relative">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
