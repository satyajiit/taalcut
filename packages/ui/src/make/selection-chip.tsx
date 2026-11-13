// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: selection chip and tray · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 (Chips: soft wash + strong text, pill, 12 px semibold; selection is marigold soft)
 * states: default (primary-soft wash, primary-strong words, kind icon) · hover (the × and an openable label darken
 *   their wash) · focus (one ring round the whole chip, instant; hidden in an inactive window; its buttons hide
 *   their own with outline-hidden, which forced colours still show; v0.4, UX1) · active (pressed wash)
 *   · disabled (gone: ink-3 on sunken, struck through, "This was deleted.", nothing to open) · loading/error/success:
 *   n/a, a chip is data; the composer carries send states · overflow ("+n" expands) · at the cap (one quiet line)
 * motion: a chip that arrives after the tray mounted rises 8 px and fades in (220 ms, ease-out); one leaving fades
 *   (120 ms, ease-in); reduced motion: fades only
 * contrast: primary-strong on primary-soft and ink-3 on sunken are chip pairs in the contrast report (≥ 4.5:1)
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import { Film, MoveHorizontal, RectangleVertical, X } from 'lucide-react';
import { CONCEPT_ICONS } from '../icons/concepts';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '#lib/cn';
import { DUR, EASE_IN, EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { UserContent } from '../cards/card-frame';
import { useTimecode, type Rate } from './timecode';

/** A point on a timeline: frames at its canvas rate. */
export interface FramePoint {
  readonly frames: number;
  readonly rate: Rate;
}

/** EDT1: the kinds of editor item a chip names besides a clip (core's EDIT_ITEM_KINDS, less `clip`). */
export type ChipItemKind = 'text' | 'graphic' | 'caption' | 'audio' | 'transition';

/** What a chip shows; the caller builds it from core's SelectionChip and the thing it names. */
export type SelectionChipView =
  | { readonly kind: 'clip'; readonly key: string; readonly index: number; readonly at: FramePoint }
  | {
      readonly kind: 'item';
      readonly key: string;
      readonly itemKind: ChipItemKind;
      readonly at: FramePoint;
      /** The item's own words (a text's, a caption's) or name (a graphic's), shown as the user's content. */
      readonly name?: string | null;
    }
  | { readonly kind: 'range'; readonly key: string; readonly start: FramePoint; readonly end: FramePoint }
  | { readonly kind: 'slot'; readonly key: string; readonly index: number; readonly name?: string | null }
  | { readonly kind: 'effect'; readonly key: string; readonly label: string }
  | { readonly kind: 'asset'; readonly key: string; readonly name: string };

/** The effect chip carries the effect concept's glyph, as the Effects button that adds it does (UX4). */
const ICONS = {
  clip: Film,
  asset: Film,
  range: MoveHorizontal,
  slot: RectangleVertical,
  effect: CONCEPT_ICONS.effect,
} as const;

const ITEM_ICONS = {
  text: CONCEPT_ICONS.text,
  graphic: CONCEPT_ICONS.graphic,
  caption: CONCEPT_ICONS.caption,
  audio: CONCEPT_ICONS.sound,
  transition: CONCEPT_ICONS.transition,
} as const;

/** The chip's words as plain text (for accessible names and announcements): "Clip 3 · 00:04". */
export function useChipLabel(): (chip: SelectionChipView) => string {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  return (chip) => {
    switch (chip.kind) {
      case 'clip': {
        const n = i18n.number(chip.index);
        const at = time.clock(chip.at.frames, chip.at.rate);
        return t`Clip ${n} · ${at}`;
      }
      case 'item': {
        const at = time.clock(chip.at.frames, chip.at.rate);
        const words: Record<ChipItemKind, string> = {
          text: t`Text · ${at}`,
          graphic: t`Graphic · ${at}`,
          caption: t`Caption · ${at}`,
          audio: t`Audio · ${at}`,
          transition: t`Transition · ${at}`,
        };
        return words[chip.itemKind];
      }
      case 'range': {
        const from = time.clock(chip.start.frames, chip.start.rate);
        const to = time.clock(chip.end.frames, chip.end.rate);
        return t`${from}–${to}`;
      }
      case 'slot': {
        const n = i18n.number(chip.index);
        return t`Slot ${n}`;
      }
      case 'effect':
        return chip.label;
      case 'asset':
        return chip.name;
    }
  };
}

export interface SelectionChipProps {
  chip: SelectionChipView;
  /** The thing is gone (a chip in history): struck through, nothing to open. */
  gone?: boolean;
  onRemove?: () => void;
  /** Selects the thing again (a chip on a sent message). */
  onOpen?: () => void;
  /** Roving tab stop inside a tray. */
  tabIndex?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  className?: string;
}

/** One selection chip: a kind icon and its label, removable in the composer, openable in history. */
export function SelectionChip({
  chip,
  gone = false,
  onRemove,
  onOpen,
  tabIndex,
  onKeyDown,
  className,
}: SelectionChipProps) {
  const { t } = useLingui();
  const labelOf = useChipLabel();
  const label = labelOf(chip);
  const Icon = chip.kind === 'item' ? ITEM_ICONS[chip.itemKind] : ICONS[chip.kind];
  const isEffect = chip.kind === 'effect';
  const name = (chip.kind === 'slot' || chip.kind === 'item') && chip.name ? chip.name : null;
  const words: ReactNode =
    chip.kind === 'asset' ? (
      <UserContent translate="no" className="max-w-[12rem] truncate">
        {label}
      </UserContent>
    ) : (
      <>
        <span className="tabular-nums">{label}</span>
        {name ? (
          <>
            <span aria-hidden> · </span>
            <UserContent translate="no" className="max-w-[10rem] truncate">
              {name}
            </UserContent>
          </>
        ) : null}
      </>
    );
  const open = onOpen && !gone ? onOpen : undefined;
  return (
    <span
      data-slot="selection-chip"
      data-kind={chip.kind}
      data-gone={gone || undefined}
      title={gone ? t`This was deleted.` : undefined}
      className={cn(
        'inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-pill text-xs font-semibold whitespace-nowrap',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus has-[:focus-visible]:outline-solid',
        'window-inactive:has-[:focus-visible]:outline-transparent',
        gone
          ? 'bg-chip text-ink-3'
          : isEffect
            ? 'bg-ai-soft text-ai-strong'
            : 'bg-primary-soft text-primary-strong',
        onRemove ? 'pr-0.5 pl-2' : 'px-2',
        className,
      )}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      {open ? (
        <button
          type="button"
          onClick={open}
          className="inline-flex min-w-0 cursor-pointer items-center rounded-pill outline-hidden hover:underline active:opacity-80"
        >
          {words}
        </button>
      ) : (
        <span className={cn('inline-flex min-w-0 items-center', gone && 'line-through')}>{words}</span>
      )}
      {gone ? <span className="sr-only">{t`This was deleted.`}</span> : null}
      {onRemove ? (
        <button
          type="button"
          aria-label={t`Remove ${label}`}
          tabIndex={tabIndex}
          onKeyDown={onKeyDown}
          onClick={onRemove}
          className={cn(
            'inline-grid size-5 shrink-0 cursor-pointer place-items-center rounded-pill outline-hidden',
            'transition-colors duration-(--dur-micro) ease-(--ease-out)',
            isEffect
              ? 'hover:bg-ai-strong/15 active:bg-ai-strong/25'
              : 'hover:bg-primary-strong/15 active:bg-primary-strong/25',
          )}
        >
          <X aria-hidden className="size-3" strokeWidth={2.5} />
        </button>
      ) : null}
    </span>
  );
}

export interface SelectionTrayProps {
  chips: readonly SelectionChipView[];
  onRemove: (key: string) => void;
  /** At most this many go with one message (core's MAX_SELECTIONS). */
  max?: number;
  className?: string;
}

const FOLDED = 6;

/**
 * The chips a message will carry, inside the composer's bar. One tab stop:
 * arrows move between chips, Delete or Backspace removes the focused one.
 * Adds and removes are announced politely.
 */
export function SelectionTray({ chips, onRemove, max = 50, className }: SelectionTrayProps) {
  const { t, i18n } = useLingui();
  const reduce = useReducedMotion();
  const labelOf = useChipLabel();
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(0);
  const [said, setSaid] = useState('');
  const tray = useRef<HTMLDivElement>(null);
  const kept = chips.slice(0, max);
  const shown = expanded || kept.length <= FOLDED + 1 ? kept : kept.slice(0, FOLDED);
  const hidden = kept.length - shown.length;
  const atCap = chips.length >= max;
  const more = i18n.number(hidden);
  const most = i18n.number(max);

  // Say what changed: one added or removed chip at a time (several: the count).
  const previous = useRef(kept);
  useEffect(() => {
    const before = previous.current;
    previous.current = kept;
    const keys = new Set(kept.map((chip) => chip.key));
    const old = new Set(before.map((chip) => chip.key));
    const added = kept.filter((chip) => !old.has(chip.key));
    const removed = before.filter((chip) => !keys.has(chip.key));
    if (added.length === 1) {
      const label = labelOf(added[0]!);
      setSaid(t`Added ${label}`);
    } else if (removed.length === 1) {
      const label = labelOf(removed[0]!);
      setSaid(t`Removed ${label}`);
    } else if (added.length > 1) {
      const count = i18n.number(added.length);
      setSaid(t`Added ${count} selections`);
    }
    // labelOf and t change with the language only; the chips are what we watch.
  }, [kept.map((chip) => chip.key).join(' ')]);

  const at = Math.min(focused, Math.max(0, shown.length - 1));
  // By key, not position: a removed chip stays in the tray while it fades out.
  const focusChip = (index: number, key = shown[index]?.key) => {
    setFocused(index);
    if (key === undefined) return;
    tray.current
      ?.querySelector<HTMLButtonElement>(`[data-chip-key="${CSS.escape(key)}"] button[aria-label]`)
      ?.focus();
  };
  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: Math.min(shown.length - 1, index + 1),
      ArrowLeft: Math.max(0, index - 1),
      Home: 0,
      End: shown.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      focusChip(moves[event.key]!);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      const chip = shown[index];
      if (!chip) return;
      // Focus stays in the tray, on the chip that takes this one's place (or the one before the last).
      const after = shown[index + 1];
      const next = after ?? shown[index - 1];
      onRemove(chip.key);
      if (next) requestAnimationFrame(() => focusChip(after ? index : index - 1, next.key));
    }
  };

  const enter = reduce ? { opacity: 0 } : { opacity: 0, y: 8 };
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div
        ref={tray}
        role="group"
        aria-label={t`What this message points at`}
        data-slot="selection-tray"
        className="flex flex-wrap items-center gap-1.5"
      >
        <AnimatePresence initial={false}>
          {shown.map((chip, index) => (
            <motion.span
              key={chip.key}
              data-chip-key={chip.key}
              className="inline-flex min-w-0"
              initial={enter}
              animate={{ opacity: 1, y: 0 }}
              exit={{
                opacity: 0,
                transition: { duration: reduce ? REDUCED_FADE : DUR.micro, ease: EASE_IN },
              }}
              transition={{ duration: reduce ? REDUCED_FADE : DUR.short, ease: EASE_OUT }}
            >
              <SelectionChip
                chip={chip}
                onRemove={() => onRemove(chip.key)}
                tabIndex={index === at ? 0 : -1}
                onKeyDown={onKeyDown(index)}
              />
            </motion.span>
          ))}
        </AnimatePresence>
        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-label={t`Show ${more} more`}
            className="inline-flex h-6 cursor-pointer items-center rounded-pill bg-chip px-2 text-xs font-semibold text-ink-2 tabular-nums transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover hover:text-ink active:bg-pressed"
          >
            {t`+${more}`}
          </button>
        ) : null}
      </div>
      {atCap ? (
        <p className="m-0 text-xs text-ink-3">{t`One message can point at ${most} things at most.`}</p>
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">
        {said}
      </span>
    </div>
  );
}
