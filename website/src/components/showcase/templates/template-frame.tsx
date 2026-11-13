// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the template, a reel with its footage taken out · mode: Operate · system: WEB2 Remix Vernacular (violet
 *   is the AI's: the slots it read and the clips it picks; rose is the music beats only; teal is never here)
 * the saved reel's own 9:16 frame, emptied: its parts bracketed over the slot strip (time layout) with the rose beat
 *   ticks under it, then the slots themselves stacked down the frame, each as tall as its time, each saying the kind
 *   of shot it wants. A camera roll's clips land in them: the clip's picture (cut a little below its middle, clear of
 *   the words on screen an exported reel carries there) opens out across its slot, its need stays readable over a
 *   scrim, and a pick the AI is less sure of says how sure (never why)
 * states: waiting (dashed violet outline, the number on violet-soft) · filled (the clip, a solid outline, the number
 *   on violet) · just landed (a rose ring bursts once: the clip came in on a music beat) · playing (your version's
 *   slot is lit, an ink outline) · compact (the index: numbers only, no brackets, no needs) · not interactive (the
 *   highlights beside it choose what fills it)
 * motion: a clip opens out from the middle of its slot (clip-path, --dur-long ease-out) as its flight lands; reduced
 *   motion: every slot fills at once with the 150 ms fade, no ring */

import { AnimatePresence, motion, type MotionValue, useMotionValueEvent } from 'motion/react';
import { type CSSProperties, useState } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { SegmentBar } from '#components/ui/segment-bar';
import { GROUP_WORDS, groupsOf } from '#components/ui/segments';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { Chip } from '../chip';
import { spriteStyle } from '../frames';
import { formatLength } from '../timecode';
import { type Roll, slotIndexAt, stillOf, type TemplateSlot, templateSegments } from './template';

const SURE_WORDS = { high: 'High', medium: 'Medium', low: 'Low' } as const;
const SURE_STEPS = { high: 3, medium: 2, low: 1 } as const;

/** The parts over the strip, each bracket as wide as its time; the words never cut, the first and last held in. */
function PartBrackets({ slots }: { readonly slots: readonly TemplateSlot[] }) {
  const total = slots.reduce((sum, s) => sum + s.length, 0) || 1;
  const groups = groupsOf(templateSegments(slots));
  return (
    <div aria-hidden className="flex gap-1">
      {groups.map((g, i) => {
        const time = slots.slice(g.from - 1, g.to).reduce((sum, s) => sum + s.length, 0);
        const place = i === 0 ? 'self-start' : i === groups.length - 1 ? 'self-end' : 'self-center';
        return (
          <span
            key={`${g.group}-${g.from}`}
            className="flex min-w-0 flex-col gap-1"
            style={{ flex: `${time / total} 1 0` }}
          >
            <span className={cn('type-caption font-semibold whitespace-nowrap text-ink-2', place)}>
              {GROUP_WORDS[g.group]}
            </span>
            <span className="h-1.5 w-full rounded-t-sm border-x border-t border-rule-strong" />
          </span>
        );
      })}
    </div>
  );
}

/** How sure the AI is of a pick, small enough for a slot: the three steps and the word, on the raised face. */
function Sure({ level }: { readonly level: keyof typeof SURE_WORDS }) {
  return (
    <span
      data-slot="confidence"
      data-level={level}
      className="inline-flex h-4.5 shrink-0 items-center gap-1 rounded-pill bg-raised px-1.5 type-caption text-ink shadow-sticker"
    >
      <AiMark className="size-2.5 text-violet-strong" />
      <span className="sr-only">AI pick, how sure:</span>
      <span aria-hidden className="inline-flex items-end gap-px">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              'block w-0.5 rounded-[1px]',
              ['h-1', 'h-1.5', 'h-2'][i],
              i < SURE_STEPS[level] ? 'bg-ink-2' : 'bg-rule',
            )}
          />
        ))}
      </span>
      {SURE_WORDS[level]}
    </span>
  );
}

interface BandProps {
  readonly slot: TemplateSlot;
  readonly clip?: { readonly clipId: string; readonly sure: keyof typeof SURE_WORDS; readonly name: string };
  readonly filled: boolean;
  readonly current: boolean;
  readonly burst: boolean;
  readonly compact: boolean;
  readonly reduce: boolean;
  readonly bandRef?: (el: HTMLLIElement | null) => void;
}

function Band({ slot, clip, filled, current, burst, compact, reduce, bandRef }: BandProps) {
  const still = clip ? stillOf(clip.clipId) : undefined;
  const style: CSSProperties = { flexGrow: slot.length, flexBasis: 0 };
  return (
    <li
      ref={bandRef}
      data-slot-n={slot.n}
      data-filled={filled || undefined}
      data-current={current || undefined}
      style={style}
      className={cn(
        'relative flex min-h-[1.125rem] items-center rounded-md',
        filled ? 'border-[1.5px] border-violet' : 'border-[1.5px] border-dashed border-violet',
        current && 'outline-2 outline-offset-1 outline-ink',
      )}
    >
      <AnimatePresence initial={false}>
        {filled && still !== undefined ? (
          <motion.span
            key={clip?.clipId}
            aria-hidden
            className="absolute inset-0 overflow-hidden rounded-[inherit]"
            initial={reduce ? { opacity: 0 } : { clipPath: 'inset(0% 46% 0% 46% round 6px)' }}
            animate={reduce ? { opacity: 1 } : { clipPath: 'inset(0% 0% 0% 0% round 6px)' }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? REDUCED_FADE : DUR.long, ease: EASE_OUT }}
          >
            <span
              data-frame="footage"
              className="absolute inset-x-0 top-1/2 block aspect-[9/16] -translate-y-[68%] bg-viewer"
              style={spriteStyle(still)}
            />
            <span className="absolute inset-0 bg-linear-to-r from-viewer/80 via-viewer/45 to-viewer/5" />
          </motion.span>
        ) : null}
      </AnimatePresence>
      {burst && !reduce ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute -inset-px rounded-[inherit] border-2 border-rose"
          initial={{ opacity: 1, scale: 1 }}
          animate={{ opacity: 0, scale: 1.08 }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
        />
      ) : null}
      <span className="relative flex w-full min-w-0 items-center gap-1.5 px-1.5">
        <span
          aria-hidden
          className={cn(
            'inline-grid h-3.5 min-w-3.5 shrink-0 place-items-center rounded-[4px] px-0.5 type-caption font-semibold tabular-nums',
            filled ? 'bg-violet text-violet-ink' : 'bg-violet-soft text-violet-strong',
          )}
        >
          {slot.n}
        </span>
        {compact ? null : (
          <span
            className={cn(
              'min-w-0 flex-1 type-meta leading-tight font-medium',
              filled ? 'text-viewer-ink' : 'text-ink',
            )}
          >
            {slot.need}
          </span>
        )}
        <span className="sr-only">
          {compact ? `Slot ${slot.n}, ` : ', '}
          {formatLength(slot.length)}
          {filled && clip ? `: ${clip.name}` : ': waiting for a clip'}
          {filled && clip?.sure === 'high' ? ', AI pick, how sure: High' : ''}
        </span>
        {filled && clip && clip.sure !== 'high' ? <Sure level={clip.sure} /> : null}
      </span>
    </li>
  );
}

export interface TemplateFrameProps {
  readonly slots: readonly TemplateSlot[];
  readonly beats: readonly number[];
  readonly roll: Roll;
  /** How many slots, from the first, hold their clip. */
  readonly landed: number;
  /** Your version's clock: while it plays, the slot it is in is lit here. */
  readonly clock: MotionValue<number>;
  readonly playing: boolean;
  /** Slots whose clip just landed: the rose ring bursts on each. */
  readonly bursts: ReadonlySet<number>;
  /** Where each slot is, for the clips' flights. */
  readonly bandRef?: (index: number) => (el: HTMLLIElement | null) => void;
  readonly compact?: boolean;
  readonly reduce: boolean;
  readonly words: (clipId: string) => string;
  readonly className?: string;
}

export function TemplateFrame({
  slots,
  beats,
  roll,
  landed,
  clock,
  playing,
  bursts,
  bandRef,
  compact = false,
  reduce,
  words,
  className,
}: TemplateFrameProps) {
  const [current, setCurrent] = useState(0);
  useMotionValueEvent(clock, 'change', (t) => {
    const next = slotIndexAt(slots, t);
    if (next !== current) setCurrent(next);
  });
  const total = slots.at(-1)?.end ?? 0;
  const full = roll.picks.length > 0 && landed >= slots.length;
  return (
    <div
      data-slot="template-frame"
      className={cn(
        'relative flex aspect-[9/16] w-full flex-col overflow-hidden rounded-reel border border-rule bg-panel shadow-sticker',
        compact ? 'gap-2 p-2' : 'gap-3 p-3',
        className,
      )}
    >
      <div className="flex flex-col gap-1.5">
        {compact ? null : <PartBrackets slots={slots} />}
        <SegmentBar
          segments={templateSegments(slots)}
          beats={beats}
          state={full ? 'filled' : 'idle'}
          layout="time"
          tone="surface"
          numbers={!compact}
          label={`Template: ${slots.length} slots, ${beats.length} music beats`}
          className="mb-2"
        />
      </div>
      <ol
        aria-label="The template’s slots, each as long as its time"
        className="m-0 flex min-h-0 flex-1 list-none flex-col gap-[3px] p-0"
      >
        {slots.map((slot, i) => {
          const pick = roll.picks[i];
          return (
            <Band
              key={slot.id}
              slot={slot}
              clip={pick ? { ...pick, name: words(pick.clipId) } : undefined}
              filled={Boolean(pick) && i < landed}
              current={playing && i === current}
              burst={bursts.has(i)}
              compact={compact}
              reduce={reduce}
              bandRef={bandRef?.(i)}
            />
          );
        })}
      </ol>
      {compact ? null : (
        <div className="flex min-h-5 items-center justify-between gap-2">
          <span className="type-meta text-ink-2 tabular-nums">
            {slots.length} slots, {formatLength(total)}
          </span>
          {full && !roll.own ? (
            <Chip tone="ai">
              <AiMark />
              AI picks
            </Chip>
          ) : null}
        </div>
      )}
    </div>
  );
}
