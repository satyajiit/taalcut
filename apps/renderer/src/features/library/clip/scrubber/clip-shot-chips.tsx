// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the shots over the filmstrip · genre: atmospheric studio app (the timeline)
 * system: DESIGN.md v0.5 · each shot is a small chip at its start: a dot in its kind's colour (shot-kinds.ts) and
 *   the kind's word ("Wide", "Close-up"), or where it starts while Taalcut hasn't described it (a neutral dot and
 *   "00:01" in JetBrains Mono), a rose person glyph when Taalcut saw people in it. A shot too short for
 *   its whole word keeps only its dot (the word stays its name): words are measured, never cut. Pressing a chip
 *   goes to the shot's start
 * states (a chip): default (ink-2 on the canvas) · hover (hover surface, ink) · focus (base ring; one tab stop,
 *   ← → Home End move between shots and seek) · active (pressed surface) · current (the shot at the playhead: raised,
 *   ink, aria-current) · disabled/loading/error/success n/a · none (not split yet: the row isn't drawn)
 * contrast: words ink-2 and ink on canvas and raised ≥ 7:1; the dots are data marks beside their words
 */
import { useLingui } from '@lingui/react/macro';
import { cn, SHOT_TYPE_LABELS, useTimecode } from '@taalcut/ui';
import { User } from 'lucide-react';
import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { fractionOf, shotAt, type ShotSpan } from '../clip-time';
import { useClockValue, type ClipClock } from '../player/clip-clock';
import { shotMark } from './shot-kinds';

const MS = { num: 1000, den: 1 } as const;
/** A chip's room besides its word (px): its padding, the dot, the gap after it, and a pixel or two to spare. */
const CHIP_ROOM = 8 + 6 + 4 + 2;
/** The person glyph and its gap (px). */
const PERSON_ROOM = 12 + 4;

/** Each chip's word as wide as it draws (px), from its own font; empty until measured. Again for new words. */
function useWordWidths(
  list: RefObject<HTMLUListElement | null>,
  spans: readonly ShotSpan[],
  locale: string,
): readonly number[] {
  const [widths, setWidths] = useState<readonly number[]>([]);
  useLayoutEffect(() => {
    const element = list.current;
    const context = document.createElement('canvas').getContext('2d');
    if (!element || !context) return;
    let live = true;
    const measure = () => {
      if (!live) return;
      const words = element.querySelectorAll<HTMLElement>('[data-slot="clip-shot-word"]');
      setWidths(
        Array.from(words, (word) => {
          context.font = getComputedStyle(word).font;
          return context.measureText(word.textContent).width;
        }),
      );
    };
    measure();
    void document.fonts.ready.then(measure);
    return () => {
      live = false;
    };
  }, [list, spans, locale]);
  return widths;
}

export interface ClipShotChipsProps {
  spans: readonly ShotSpan[];
  length: number;
  /** The row's width (px), to know which words fit their shots. */
  width: number;
  clock: ClipClock;
  onSeek: (at: number) => void;
}

export const ClipShotChips = memo(function ClipShotChips({
  spans,
  length,
  width: rowWidth,
  clock,
  onSeek,
}: ClipShotChipsProps) {
  const { t, i18n } = useLingui();
  const timecode = useTimecode();
  const list = useRef<HTMLUListElement>(null);
  const select = useCallback((at: number) => shotAt(spans, at)?.index ?? -1, [spans]);
  const current = useClockValue(clock, select);
  const count = spans.length;
  const words = useWordWidths(list, spans, i18n.locale);

  const move = (event: KeyboardEvent<HTMLUListElement>) => {
    // From the chip that has the focus (the playhead may be elsewhere).
    const focused = event.target instanceof HTMLElement ? Number(event.target.dataset['index']) : Number.NaN;
    const from = Number.isNaN(focused) ? Math.max(0, current) : focused;
    const next =
      event.key === 'ArrowRight'
        ? from + 1
        : event.key === 'ArrowLeft'
          ? from - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const span = spans[Math.min(count - 1, Math.max(0, next))];
    if (!span) return;
    onSeek(span.from);
    list.current?.querySelectorAll<HTMLButtonElement>('button[data-slot="clip-shot"]')[span.index]?.focus();
  };

  return (
    <ul
      ref={list}
      aria-label={t`Shots`}
      data-slot="clip-shots"
      onKeyDown={move}
      className="relative m-0 h-6 list-none p-0"
    >
      {spans.map((span) => {
        const left = fractionOf(span.from, length) * 100;
        const width = Math.max(0, fractionOf(span.to, length) * 100 - left);
        const kind = span.shot.shotType ? i18n._(SHOT_TYPE_LABELS[span.shot.shotType]) : null;
        const people = span.shot.analysis?.description?.people ?? 0;
        const number = span.index + 1;
        const isCurrent = span.index === current;
        const start = timecode.clock(Math.round(span.from), MS);
        const room = (width / 100) * rowWidth;
        const word = words[span.index];
        const wordFits = word !== undefined && word + CHIP_ROOM <= room;
        const personFits = wordFits && word + CHIP_ROOM + PERSON_ROOM <= room;
        return (
          <li
            key={span.shot.id}
            className="absolute inset-y-0"
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            <button
              type="button"
              data-slot="clip-shot"
              tabIndex={isCurrent || (current < 0 && span.index === 0) ? 0 : -1}
              aria-current={isCurrent || undefined}
              data-index={span.index}
              aria-label={
                kind ? t`Shot ${number} of ${count}, ${kind}` : t`Shot ${number} of ${count}, from ${start}`
              }
              onClick={() => onSeek(span.from)}
              className={cn(
                'flex h-full max-w-full cursor-pointer items-center gap-1 rounded-sm px-1 text-2xs font-medium text-ink-2',
                'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover hover:text-ink active:bg-pressed',
                isCurrent && 'bg-raised text-ink shadow-xs hover:bg-raised',
              )}
            >
              <span
                aria-hidden
                className={cn('size-1.5 shrink-0 rounded-pill', shotMark(span.shot.shotType))}
              />
              <span
                aria-hidden
                data-slot="clip-shot-word"
                className={cn('whitespace-nowrap', !wordFits && 'hidden', !kind && 'font-mono tabular-nums')}
              >
                {kind ?? start}
              </span>
              {people > 0 && personFits ? (
                <User aria-hidden className="size-3 shrink-0 text-rose-strong" />
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
});
