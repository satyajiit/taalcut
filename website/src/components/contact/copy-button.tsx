// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: copy button · copies one address to the clipboard
 * mode: Persuade · system: WEB2 Remix Vernacular (a small control pill; done is teal, yours)
 * states: default (control face, copy glyph, "Copy") · hover (control-hover) · focus (base ring) · active (gives 3%)
 *   · copied (teal tick, "Copied", for two seconds, announced) · selected (the browser wouldn't copy: the address is
 *   selected on the page instead and a hint says how to finish, announced) · disabled: never · loading: none (copying
 *   is instant) · without JavaScript (not shown: the address beside it is a mailto link and can be selected by hand)
 * reduced motion: the glyph swaps without its pop */

import { Check, Copy, TextSelect } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { CONTACT_PAGE } from '#content/contact';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';

type CopyState = 'idle' | 'done' | 'selected';

/** Selects an element's text on the page, so ⌘C or Ctrl+C finishes the copy. */
function selectText(el: Element | null) {
  if (!el) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function CopyButton({ text, target }: { readonly text: string; readonly target: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const [ready, setReady] = useState(false);
  const reduce = useReducedMotionPref();
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    setReady(true);
    return () => window.clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState('done');
    } catch {
      selectText(document.getElementById(target));
      setState('selected');
    }
    timer.current = window.setTimeout(() => setState('idle'), 2400);
  };

  const words = {
    idle: CONTACT_PAGE.copy.idle,
    done: CONTACT_PAGE.copy.done,
    selected: CONTACT_PAGE.copy.selected,
  }[state];
  const Glyph = { idle: Copy, done: Check, selected: TextSelect }[state];
  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`${words} ${text}`}
        data-state={state}
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill border px-3.5 type-label select-none',
          'transition-[background-color,border-color,color,scale] duration-(--dur-micro) ease-(--ease-out) active:scale-[0.97] motion-reduce:active:scale-100',
          state === 'done'
            ? 'border-teal-strong bg-teal-soft text-teal-strong'
            : 'border-rule bg-control text-ink hover:bg-control-hover active:bg-control-pressed',
          !ready && 'invisible',
        )}
      >
        <motion.span
          key={state}
          aria-hidden
          initial={reduce ? false : { scale: 0.4, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 22 }}
          className="inline-flex"
        >
          <Glyph strokeWidth={ICON_STROKE} className="size-4" />
        </motion.span>
        <span aria-hidden>{words}</span>
      </button>
      <span role="status" className="sr-only">
        {state === 'done'
          ? `${CONTACT_PAGE.copy.done}: ${text}`
          : state === 'selected'
            ? CONTACT_PAGE.copy.selectedHint
            : ''}
      </span>
    </>
  );
}
