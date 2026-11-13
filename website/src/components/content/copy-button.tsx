// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: copy button · mode: Act · system: WEB2 Remix Vernacular
 * states: default (Copy icon, "Copy") · hover (control-hover ground) · focus (the base ring) · active (2 % give) ·
 *   copying (aria-busy, a beat at most) · success (teal check, "Copied", for 2 s, announced) · error (the clipboard
 *   refused: "Select the text to copy", announced, the text beside it stays selectable) · disabled (never: it
 *   always has its text) · reduced motion (the icon swaps without its pop)
 * Copies one piece of text (a description, a colour, an address) to the clipboard. Its name says what it copies
 * ("Copy the one-line description"), its words say what happened. A live region beside it tells assistive
 * technology. */

import { Check, Copy, TriangleAlert } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { buttonClasses } from '#components/ui/button';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { POP } from '#lib/motion';

type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

const WORDS: Readonly<Record<CopyState, string>> = {
  idle: 'Copy',
  copying: 'Copy',
  copied: 'Copied',
  failed: 'Select the text to copy',
};

export function CopyButton({
  text,
  what,
  size = 'md',
  className,
}: {
  readonly text: string;
  /** What it copies, read after the button's words: "the one-line description". */
  readonly what: string;
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | undefined>(undefined);
  const reduce = useReducedMotionPref();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    setState('copying');
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    timer.current = window.setTimeout(() => setState('idle'), 2400);
  };

  const Icon = state === 'copied' ? Check : state === 'failed' ? TriangleAlert : Copy;
  return (
    <span className={cn('inline-flex items-center', className)}>
      <button
        type="button"
        onClick={copy}
        aria-busy={state === 'copying' || undefined}
        data-state={state}
        className={buttonClasses(
          'secondary',
          'md',
          cn(
            size === 'sm' ? 'h-8 gap-1.5 px-3 type-label-sm' : '',
            state === 'copied' ? 'border-teal-strong/40 text-teal-strong' : '',
            state === 'failed' ? 'border-rose-strong/50 text-rose-strong' : '',
          ),
        )}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={state === 'copying' ? 'idle' : state}
            aria-hidden
            initial={reduce ? { opacity: 0 } : { scale: POP.scale, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={reduce ? { duration: 0.15 } : POP.spring}
            className="inline-flex"
          >
            <Icon strokeWidth={ICON_STROKE} className={size === 'sm' ? 'size-3.5' : 'size-4'} />
          </motion.span>
        </AnimatePresence>
        <span>
          {WORDS[state]}
          <span className="sr-only"> {what}</span>
        </span>
      </button>
      <span role="status" className="sr-only">
        {state === 'copied' ? `Copied ${what}` : state === 'failed' ? `Couldn’t copy ${what}. Select the text to copy it.` : ''}
      </span>
    </span>
  );
}
