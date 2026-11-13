// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the long video, read for a short · mode: Operate · system: WEB2 Remix Vernacular (violet is the AI's
 *   pick; the hook and the payoff take the app's slot-role hues, each with its word)
 * one long trip video as the app's timeline draws a source: its scenes end to end on one filmstrip (the owner's
 *   clips), what the creator says under them as one bar per sentence, and over the bars the AI's marks: the hook, the
 *   context and the payoff, each a whole sentence over whole scenes. Point at a sentence, or Tab to it, and the line
 *   under the lanes reads it out with its place in the long video. On a narrow window the lanes scroll sideways
 * states: a sentence: not picked (sunken) · marked as the hook, context or payoff (its hue, its role over it) ·
 *   pointed at or focused (base ring, ink edge; the line reads it) · default/hover/active as a button ·
 *   disabled/loading/error n/a
 * motion: a mark pops onto its sentence in turn as the AI reads (scale and opacity, spring), the role tags with it;
 *   reduced motion: the marks are there */

import { Flag, Magnet, TextQuote } from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useId, useState } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { Sticker } from '#components/ui/sticker';
import { cn } from '#lib/cn';
import { frameOf, spriteStyle } from '../frames';
import { pop } from '../vignette';
import { clock, type Line, LINES, lineSpan, LONG_SECONDS, type Pick, type Role, SCENES } from './trip';

/** Each role's colours: its bar, its tag, and the words. */
export const ROLE_LOOK: Readonly<
  Record<Role, { readonly bar: string; readonly tag: string; readonly word: string }>
> = {
  hook: {
    bar: 'bg-slot-hook-soft border-slot-hook-strong',
    tag: 'bg-slot-hook-soft text-slot-hook-strong',
    word: 'Hook',
  },
  context: {
    bar: 'bg-violet-soft border-violet-strong',
    tag: 'bg-violet-soft text-violet-strong',
    word: 'Context',
  },
  payoff: {
    bar: 'bg-slot-outro-soft border-slot-outro-strong',
    tag: 'bg-slot-outro-soft text-slot-outro-strong',
    word: 'Payoff',
  },
};

export function RoleGlyph({ role, className }: { readonly role: Role; readonly className?: string }) {
  if (role === 'hook') return <Magnet aria-hidden className={className} />;
  if (role === 'payoff') return <Flag aria-hidden className={className} />;
  return <AiMark className={className} />;
}

const pct = (n: number) => `${(n / SCENES.length) * 100}%`;

/** Where a role's tag sits: over its first sentence (the payoff's, right-aligned at its end), and a context tag never
 * under the hook's on a narrow strip, where the hook's sentence is shorter than its tag. */
function tagAt(role: Role, first: number, scenes: number, afterHook: boolean): string {
  if (role === 'payoff') return pct(first + scenes);
  return role === 'context' && afterHook ? `max(${pct(first)}, 4.5rem)` : pct(first);
}

export function LongVideo({
  picks,
  marked,
  reduce,
  compact = false,
}: {
  readonly picks: readonly Pick[];
  /** How many of the picks the AI has marked so far (all of them at rest). */
  readonly marked: number;
  readonly reduce: boolean;
  readonly compact?: boolean;
}) {
  const id = useId();
  const [pointed, setPointed] = useState<Line | null>(null);
  const roleOf = new Map(picks.map((p, i) => [p.line.id, { role: p.role, on: i < marked }]));
  // A role's tag sits over the first of its marked sentences.
  const tagged = new Set<string>();
  const tags = picks.flatMap((p, i) => {
    if (i >= marked || tagged.has(p.role)) return [];
    tagged.add(p.role);
    return [p];
  });
  const read = pointed ? roleOf.get(pointed.id) : undefined;
  const [from, to] = pointed ? lineSpan(pointed) : [0, 0];

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex flex-col gap-2.5">
        <div className="relative -mx-1 overflow-x-auto px-1 pb-1">
          <div
            role="group"
            aria-label="The long video’s scenes and what is said over them"
            aria-describedby={`${id}-read`}
            className={cn('relative flex flex-col gap-1.5', compact ? 'min-w-120' : 'min-w-144')}
          >
            <div aria-hidden className="relative h-6">
              <AnimatePresence initial={false}>
                {tags.map((p) => {
                  const look = ROLE_LOOK[p.role];
                  const first = p.line.scenes[0] ?? 0;
                  return (
                    <motion.span
                      key={p.role}
                      className={cn(
                        'absolute bottom-0 inline-flex items-center gap-1 rounded-pill px-2 py-0.5 type-caption font-semibold whitespace-nowrap shadow-xs [&_svg]:size-3',
                        look.tag,
                        p.role === 'payoff' && '-translate-x-full',
                      )}
                      style={{ left: tagAt(p.role, first, p.line.scenes.length, tags[0]?.role === 'hook') }}
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, transition: { duration: 0 } }}
                      transition={pop(0, reduce)}
                    >
                      <RoleGlyph role={p.role} />
                      {look.word}
                    </motion.span>
                  );
                })}
              </AnimatePresence>
            </div>
            <div aria-hidden className="flex overflow-hidden rounded-md">
              {SCENES.map((s) => (
                <span key={s.clipId} className="min-w-0 flex-1 border-e border-viewer last:border-e-0">
                  <span
                    data-frame="footage"
                    className="block aspect-[9/16] w-full bg-viewer"
                    style={spriteStyle(frameOf(s.clipId) ?? 0)}
                  />
                </span>
              ))}
            </div>
            <ul className="relative m-0 h-7 list-none p-0">
              {LINES.map((line) => {
                const first = line.scenes[0] ?? 0;
                const state = roleOf.get(line.id);
                const on = state?.on ?? false;
                const look = state ? ROLE_LOOK[state.role] : null;
                return (
                  <li
                    key={line.id}
                    className="absolute inset-y-0 px-0.5"
                    style={{ left: pct(first), width: pct(line.scenes.length) }}
                  >
                    <button
                      type="button"
                      data-line={line.id}
                      data-role={on ? state?.role : undefined}
                      aria-label={`${on && look ? `${look.word}: ` : ''}${line.text}`}
                      onPointerEnter={() => setPointed(line)}
                      onFocus={() => setPointed(line)}
                      onClick={() => setPointed(line)}
                      className={cn(
                        'relative block size-full overflow-hidden rounded-md border transition-colors duration-(--dur-micro) ease-(--ease-out)',
                        pointed?.id === line.id ? 'border-ink' : 'border-transparent',
                        'bg-sunken hover:bg-hover',
                      )}
                    >
                      {look ? (
                        <motion.span
                          aria-hidden
                          className={cn('absolute inset-0 rounded-[inherit] border-2', look.bar)}
                          initial={false}
                          animate={on ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.7 }}
                          transition={on ? pop(0, reduce) : { duration: 0 }}
                        />
                      ) : null}
                      <TextQuote aria-hidden className="relative mx-auto size-3.5 text-ink-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div aria-hidden className="flex justify-between tc-mono type-caption text-ink-3">
              <span>0:00</span>
              <span>{clock(LONG_SECONDS)}</span>
            </div>
          </div>
        </div>
        {compact ? null : (
          <span className="pointer-events-none absolute right-2 bottom-0 hidden @min-[56rem]:block [&>*]:pointer-events-auto">
            <Sticker field="violet" mark={<AiMark className="size-full" />} tilt={-3} size="sm">
              Whole sentences, whole scenes
            </Sticker>
          </span>
        )}
        <p
          id={`${id}-read`}
          className={cn('m-0 min-h-[2lh] type-body text-ink-2 @min-[44rem]:min-h-[1lh]', !compact && '@min-[56rem]:pe-64')}
        >
          {pointed ? (
            <>
              <span className="text-ink">“{pointed.text}”</span>{' '}
              {read?.on ? `${ROLE_LOOK[read.role].word}, ` : 'Not in this short, '}
              <span className="tc-mono">{clock(from)}</span> to <span className="tc-mono">{clock(to)}</span>{' '}
              of the long video.
            </>
          ) : (
            'Point at a sentence, or Tab to it, to read what is said there.'
          )}
        </p>
      </div>
    </MotionConfig>
  );
}
