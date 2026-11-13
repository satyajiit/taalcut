// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: home demo kit · mode: Persuade · system: WEB2 Remix Vernacular
 * states: Play again, an icon button in a demo window's title bar (default: round, rule ring · hover: control fill ·
 *   focus: base ring · active: 4 % give · gone under reduced motion, where a demo already shows its finished state; at
 *   least 24 px however small the window scales) · more link (default: ink, rule underline · hover: ink underline,
 *   the arrow steps right · focus: base ring) · thumb, AI-pick chip and sure meter are drawings (no states).
 * The small parts every home demo shares: a demo's one run (useReplay: the finished state in the server HTML, played
 * once when it arrives, again on Play again), an atlas frame cropped to its box, the AI-pick chip, the app's
 * three-step sure meter in neutral ink with its word, and the section's link onward. */

import { ArrowRight, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, type RefObject, useCallback, useEffect, useState } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { SURE, type Sure } from '#content/home';
import { type ArrivalState, useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { spriteStyle } from './reel-data';

/**
 * A demo's run: 'shown' is its finished state (the server HTML, on screen at load, reduced motion). Below the fold it
 * starts 'hidden' and plays to 'shown' once it arrives; `replay` plays it again from the top. `ran` turns true the
 * first time a run starts in the browser: a decorative layer that rests hidden (a scan, a caret) mounts only then, so
 * the server HTML never holds anything at opacity 0.
 */
export function useReplay(ref: RefObject<Element | null>, amount?: number) {
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce, amount });
  const [override, setOverride] = useState<ArrivalState | null>(null);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (override !== 'hidden') return undefined;
    // Two frames at the start, so the snap back lands before the run plays.
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => setOverride('shown'));
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [override]);
  const replay = useCallback(() => {
    setRun((n) => n + 1);
    setOverride('hidden');
  }, []);
  const state: ArrivalState = reduce ? 'shown' : (override ?? arrival);
  const [ran, setRan] = useState(false);
  // Derived during render (React's pattern for state that follows a prop), so the layer mounts with the hidden state.
  if (state === 'hidden' && !ran) setRan(true);
  return { state, replay, reduce, run, ran } as const;
}

/**
 * Play a demo again: a round icon button for its window's title bar (AppWindow's `actions`), named by `label`. Inside
 * the window it is sized in design px, never under 24 px on screen. Absent under reduced motion.
 */
export function ReplayButton({ onReplay, label, className }: { readonly onReplay: () => void; readonly label: string; readonly className?: string }) {
  const reduce = useReducedMotionPref();
  if (reduce) return null;
  return (
    <button
      type="button"
      onClick={onReplay}
      aria-label={label}
      title={label}
      data-slot="replay"
      className={cn(
        'inline-grid size-[max(1.5rem,calc(var(--spacing)*8))] shrink-0 place-items-center rounded-pill border border-rule bg-control text-ink-2 select-none',
        'transition-[background-color,color,transform] duration-(--dur-micro) ease-(--ease-out)',
        'hover:bg-control-hover hover:text-ink active:scale-[0.96] active:bg-control-pressed motion-reduce:active:scale-100',
        className,
      )}
    >
      <RotateCcw aria-hidden strokeWidth={ICON_STROKE} className="size-[max(0.875rem,calc(var(--spacing)*4))]" />
    </button>
  );
}

/** A round icon-only button (its name in aria-label): the secondary button's faces, square. */
export function iconButtonClasses(size: 'md' | 'lg' = 'md', className?: string): string {
  return cn(
    'inline-grid shrink-0 place-items-center rounded-pill border border-rule bg-control text-ink select-none',
    'transition-[background-color,color,transform] duration-(--dur-micro) ease-(--ease-out)',
    'not-disabled:hover:bg-control-hover not-disabled:active:scale-[0.96] not-disabled:active:bg-control-pressed motion-reduce:active:scale-100',
    'disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-transparent disabled:text-ink-disabled',
    size === 'md' ? 'size-10' : 'size-11',
    className,
  );
}

/** An atlas frame covering its box (the box sets the size and the shape; the frame keeps its own 9:16). */
export function Thumb({ sprite, className, children }: { readonly sprite: number; readonly className?: string; readonly children?: ReactNode }) {
  return (
    <span aria-hidden className={cn('relative block overflow-hidden bg-viewer', className)}>
      <span className="absolute top-1/2 left-0 aspect-[9/16] w-full -translate-y-1/2" style={spriteStyle(sprite)} />
      {children}
    </span>
  );
}

/** The AI's pick, as the app marks it: the AI mark and the words, soft on a surface or solid on footage. */
export function AiPickChip({
  label,
  solid = false,
  narrow = false,
  className,
}: {
  readonly label: string;
  readonly solid?: boolean;
  /** In an app window narrower than 28 rem, keep the mark and drop the words. */
  readonly narrow?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 type-caption font-semibold whitespace-nowrap',
        solid ? 'bg-violet text-violet-ink shadow-sm' : 'bg-violet-soft text-violet-strong',
        className,
      )}
    >
      <AiMark className="size-3.5" />
      <span className={narrow ? '@max-md:hidden' : undefined}>{label}</span>
    </span>
  );
}

const STEPS: Readonly<Record<Sure, number>> = { high: 3, medium: 2, low: 1 };

/** How sure the AI is: three steps in neutral ink and the app's word (High, Medium, Low). */
export function SureMeter({ sure, className }: { readonly sure: Sure; readonly className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 type-caption font-medium text-ink-2', className)}>
      <span aria-hidden className="flex items-end gap-0.5">
        {[1, 2, 3].map((n) => (
          <span key={n} className={cn('w-1 rounded-pill', n === 1 ? 'h-1.5' : n === 2 ? 'h-2.5' : 'h-3.5', n <= STEPS[sure] ? 'bg-ink-2' : 'bg-rule')} />
        ))}
      </span>
      {SURE[sure]}
    </span>
  );
}

type MoreHref = '/ai/' | '/download/' | '/faq/' | '/faq/#footage-leaves' | '/features/' | `/features/${string}/`;

/** The section's way onward: words and an arrow that steps right on hover. */
export function MoreLink({ href, children, className }: { readonly href: MoreHref; readonly children: ReactNode; readonly className?: string }) {
  return (
    <Link
      href={href as never}
      className={cn(
        'group inline-flex min-h-6 items-center gap-1.5 py-1 type-label font-semibold text-ink underline decoration-rule-strong underline-offset-4',
        'transition-[text-decoration-color] duration-(--dur-micro) hover:decoration-ink',
        className,
      )}
    >
      {children}
      <ArrowRight
        aria-hidden
        strokeWidth={ICON_STROKE}
        className="size-4 transition-transform duration-(--dur-short) ease-(--ease-out) group-hover:translate-x-1 motion-reduce:transition-none"
      />
    </Link>
  );
}
