// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Continue with ChatGPT, demonstrated · mode: Persuade (show, don't tell) · system: WEB2 Remix Vernacular
 * states: signed in (finished: the server HTML, reduced motion, and every rest after the run; both stickers on the
 *   window) · playing (on arrival from below the fold the three steps play once, 3.2 s, under the 5 s pause rule; the
 *   segment bar fills stories style; each sticker pops on its step) · a step (the bar's buttons, the window's own
 *   Continue, Cancel and Sign out) · Play again (in the window's bar; gone under reduced motion) · the moment beside the
 *   window says the step in big words with the facts it carries, changing with a short rise (a 150 ms fade under
 *   reduced motion); a one-line status tells assistive technology the step.
 * motion: one run (the bar's fill, the stickers' pop on the world's spring, the moment's rise); transform and opacity.
 * The page's lead: Settings › Accounts in the coded window, larger than any other window on the page, its three steps
 * as a segment bar over it, from the Accounts row through the sign-in on OpenAI's own page to the plan in use. Each step
 * carries its facts (CHATGPT.facts, word for word); "Taalcut never sees your password" lands on the window as you sign
 * in, and "No second bill from Taalcut" as the plan comes on. Kaatu, decoration, is a sticker on the window's corner. */

import { LogIn, ReceiptText } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { ReplayButton } from '#components/home/kit';
import { Kaatu } from '#components/kaatu/kaatu';
import { Sticker } from '#components/ui/sticker';
import { CHATGPT_MOMENTS, CHATGPT_STICKERS } from '#content/ai-stories';
import { CHATGPT } from '#content/providers';
import { useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT, POP, REDUCED_FADE } from '#lib/motion';
import { ChatgptSteps } from './chatgpt-steps';
import { type ChatgptStep, ChatgptWindow } from './chatgpt-window';

/** How long the run holds each of the first two steps, in ms. 1.5 + 1.7 s: the whole run stays under 5 s. */
const HOLD = [1500, 1700] as const;
/** The sign-in a press of Continue starts, before the plan shows. */
const SIGN_IN_MS = 1400;

/** A sticker on the window from its step on: it pops in once the page has moved, and simply rests in the server HTML. */
function StepSticker({ shown, ran, reduce, className, children }: { readonly shown: boolean; readonly ran: boolean; readonly reduce: boolean; readonly className: string; readonly children: ReactNode }) {
  if (!shown) return null;
  return (
    <motion.span
      initial={ran ? (reduce ? { opacity: 0 } : { opacity: 0, scale: POP.scale }) : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={reduce ? { duration: REDUCED_FADE } : POP.spring}
      className={cn('pointer-events-none absolute z-20 inline-flex', className)}
    >
      {children}
    </motion.span>
  );
}

function Moment({ step, reduce }: { readonly step: ChatgptStep; readonly reduce: boolean }) {
  const s = CHATGPT.steps[step];
  const moment = CHATGPT_MOMENTS[step];
  const facts = moment?.facts ?? [];
  const lead = moment?.lead === undefined ? s.line : (CHATGPT.facts[moment.lead]?.[1] ?? s.line);
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        data-slot="chatgpt-moment"
        data-step={s.id}
        initial={{ opacity: 0, y: reduce ? 0 : 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: DUR.micro } }}
        transition={reduce ? { duration: REDUCED_FADE } : { duration: DUR.long, ease: EASE_OUT }}
        className="flex flex-col gap-5"
      >
        <p className="m-0 type-site-subhead text-pretty text-ink">{lead}</p>
        {facts.map((f) => {
          const [label, value] = CHATGPT.facts[f] ?? ['', ''];
          return (
            <p key={label} className="m-0 max-w-[34em] type-site-body text-pretty text-ink-2">
              <span className="font-semibold text-ink">{label}.</span> {value}
            </p>
          );
        })}
      </motion.div>
    </AnimatePresence>
  );
}

export function ChatgptDemo() {
  const root = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(root, { reduce, amount: 0.35 });
  // The server HTML and reduced motion show the finished state: signed in.
  const [step, setStep] = useState<ChatgptStep>(2);
  const [playing, setPlaying] = useState(false);
  const [ran, setRan] = useState(false);
  const timers = useRef<number[]>([]);
  const waited = useRef(false);

  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPlaying(false);
  }, []);
  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));

  const run = useCallback(() => {
    stop();
    setRan(true);
    setStep(0);
    setPlaying(true);
    timers.current.push(window.setTimeout(() => setStep(1), HOLD[0]));
    timers.current.push(
      window.setTimeout(() => {
        setStep(2);
        setPlaying(false);
      }, HOLD[0] + HOLD[1]),
    );
  }, [stop]);

  useEffect(() => {
    if (arrival === 'hidden') {
      waited.current = true;
      setStep(0);
      return;
    }
    if (!waited.current) return;
    waited.current = false;
    run();
  }, [arrival, run]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const pick = (s: ChatgptStep) => {
    stop();
    setRan(true);
    setStep(s);
  };
  const signIn = () => {
    pick(1);
    later(SIGN_IN_MS, () => setStep(2));
  };

  return (
    <div ref={root} className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
        <ChatgptSteps step={step} playing={playing} holds={HOLD} onPick={pick} reduce={reduce} />
        <div className="relative">
          <ChatgptWindow
            step={step}
            onSignIn={signIn}
            onCancel={() => pick(0)}
            onSignOut={() => pick(0)}
            reduce={reduce}
            actions={<ReplayButton onReplay={run} label={CHATGPT_STICKERS.replay} />}
          />
          <StepSticker shown={step >= 1} ran={ran} reduce={reduce} className="-top-4 right-3 sm:right-24">
            <Sticker field="sky" icon={LogIn} tilt={3} pop={false}>
              {CHATGPT_STICKERS.password}
            </Sticker>
          </StepSticker>
          {/* Kaatu, a sticker character slapped on the window's corner, gives the plan a thumbs up (wide screens only). */}
          <span aria-hidden className="pointer-events-none absolute -bottom-14 -left-16 z-20 hidden lg:inline-flex">
            <Kaatu pose="thumbs-up" size={116} follow sticker />
          </span>
          <StepSticker shown={step === 2} ran={ran} reduce={reduce} className="right-2 -bottom-6 sm:-right-5">
            <Sticker field="lime" icon={ReceiptText} tilt={-4} size="lg" pop={false}>
              {CHATGPT_STICKERS.bill}
            </Sticker>
          </StepSticker>
        </div>
      </div>
      <div className="min-w-0 pt-4 lg:col-span-4 lg:pt-20">
        <Moment step={step} reduce={reduce} />
        <p aria-live="polite" className="sr-only">
          {CHATGPT_STICKERS.stepOf(step + 1, CHATGPT.steps[step].label)}
        </p>
      </div>
    </div>
  );
}
