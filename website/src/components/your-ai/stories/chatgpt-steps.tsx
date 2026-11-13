// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the sign-in's segment bar · mode: Persuade · system: WEB2 Remix Vernacular
 * states: a step: done (its segment full, violet) · current (aria-current="step": full, or filling stories style while
 *   the run plays it; its name in ink) · to come (an empty violet-soft track) · each one a real button: default ·
 *   hover (the name darkens) · focus (base ring) · active (2 % give) · reduced motion (the fill steps at once).
 * motion: the current segment fills on a linear clock while the run plays; scaleX only.
 * The window's three steps as the world's segment bar, laid over the window as a story's bar lies over its frame: one
 * segment a step, each named over a bracket the way a template's parts are, the AI's violet filling them. A press on
 * a step jumps the window to it. */

import { motion } from 'motion/react';
import { CHATGPT_STICKERS } from '#content/ai-stories';
import { CHATGPT } from '#content/providers';
import { cn } from '#lib/cn';
import { DUR } from '#lib/motion';
import type { ChatgptStep } from './chatgpt-window';

export interface ChatgptStepsProps {
  readonly step: ChatgptStep;
  readonly playing: boolean;
  /** How long the run holds each step while it plays, in ms (the last rests). */
  readonly holds: readonly number[];
  readonly onPick: (s: ChatgptStep) => void;
  readonly reduce: boolean;
  readonly className?: string;
}

export function ChatgptSteps({ step, playing, holds, onPick, reduce, className }: ChatgptStepsProps) {
  return (
    <ol aria-label={CHATGPT_STICKERS.steps} data-slot="chatgpt-steps" className={cn('m-0 grid list-none grid-cols-3 gap-1.5 p-0', className)}>
      {CHATGPT.steps.map((s, i) => {
        const done = i < step;
        const current = i === step;
        const filling = current && playing && !reduce && i < holds.length;
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(i as ChatgptStep)}
              aria-current={current ? 'step' : undefined}
              className="group flex min-h-12 w-full flex-col items-stretch gap-1.5 rounded-lg pt-1 pb-1.5 text-left transition-transform duration-(--dur-micro) ease-(--ease-out) active:scale-[0.98] motion-reduce:active:scale-100"
            >
              <span className={cn('inline-flex items-baseline gap-1.5 ps-1 type-label whitespace-nowrap', current ? 'font-semibold text-ink' : 'text-ink-2 group-hover:text-ink')}>
                <span className="type-timecode text-ink-3">{i + 1}</span>
                {s.label}
              </span>
              <span aria-hidden className="h-1.5 w-full rounded-t-sm border-x border-t border-rule-strong" />
              <span aria-hidden className="relative block h-2 w-full overflow-hidden rounded-sm bg-violet-soft">
                <motion.span
                  key={`${s.id}-${filling ? 'play' : 'rest'}`}
                  className="absolute inset-0 origin-left rounded-[inherit] bg-violet"
                  initial={{ scaleX: filling ? 0 : done || current ? 1 : 0 }}
                  animate={{ scaleX: done || current ? 1 : 0 }}
                  transition={filling ? { duration: (holds[i] ?? 600) / 1000, ease: 'linear' } : { duration: reduce ? 0 : DUR.short }}
                />
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
