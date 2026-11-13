// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: working line · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 (A7: Arrival is the chat's one entrance) · states: thinking (Kaatu looks up and
 *   nibbles, a beat a second; "Working on it…") · quiet (the agent's own words or thinking already show it: Kaatu only) ·
 *   happy (a short grin, no words: success is silent) · oops (a short bashful look; the error line says what
 *   happened) · gone. Not a control. Reduced motion: a fade, and the look-and-nibble keeps going, slower. */

import { useLingui } from '@lingui/react/macro';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '#lib/cn';
import { Kaatu } from '../brand/mascot';
import type { RunMood } from '../brand/use-mascot-mood';

const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

export interface WorkingLineProps extends RunMood {
  /**
   * The run is already visibly talking or thinking (a streaming answer, an open
   * "Thinking…"): Kaatu stays, the words go, so the line never repeats them.
   */
  quiet?: boolean;
  className?: string;
}

/**
 * The foot of the transcript while the agent works: Kaatu, looking up and nibbling, and
 * a few quiet words. It is the only place Kaatu appears once a chat has
 * messages, and it is a status line, not an avatar: the agent's words keep the
 * AI mark. Words are announced once, politely, when the work starts.
 */
export function WorkingLine({ mood, visible, quiet = false, className }: WorkingLineProps) {
  const { t } = useLingui();
  const reduce = useReducedMotion();
  const words = visible && mood === 'thinking' && !quiet ? t`Working on it…` : '';
  return (
    <div data-slot="chat-working-line" className={cn('contents', className)}>
      {/* Always mounted, so the words are announced when they appear. */}
      <p role="status" className="sr-only">
        {words}
      </p>
      <AnimatePresence initial={false}>
        {visible ? (
          <motion.div
            key="working"
            data-slot="chat-working"
            data-mood={mood}
            aria-hidden
            className="flex items-center gap-2"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0.15, ease: 'linear' } : { duration: 0.22, ease: EASE_OUT }}
          >
            <Kaatu spot="line" mood={mood} breathe={false} />
            {words && !quiet ? <span className="text-sm text-ink-2">{words}</span> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
