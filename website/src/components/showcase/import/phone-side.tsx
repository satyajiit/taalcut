// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the phone's side of Phone over Wi-Fi · mode: Operate · system: WEB2 Remix Vernacular (teal is yours)
 * a coded iPhone beside the window, open on the page Taalcut serves to the phone's own browser (nothing to install),
 *   in that page's words (packages/transfer/phone/locales/en.json): while it asks, the two-digit match code and
 *   "Waiting for approval on your computer…"; told no, "Your computer said no." and Ask again; allowed, Choose videos
 *   with the iPhone's two choices (Choose from Files, original quality; Choose from Photos, quicker, may be a smaller
 *   copy), then each clip it sent with its state (Sending, Adding to your library, Added) and how many are added
 * states: asking · denied · allowed (the choices: default, hover, focus, active, disabled once the phone has sent
 *   all it holds) · Ask again (default, hover, focus, active) · the rows' states. The window beside it says the same
 *   for assistive technology in its own words, so the phone's lines aren't announced twice
 * motion: a screen crossfades into the next, a row rises in as it starts (--dur-short, ease-out); the waiting
 *   spinner turns; reduced motion: the crossfade alone, the spinner still */

import { FolderOpen, Images, LoaderCircle, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { Logo } from '#components/brand/logo';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT, RISE } from '#lib/motion';
import { clipById } from '../auto-pick/roll';
import { ClipFrame } from '../frame';
import type { WifiRun } from './wifi-run';
import { MATCH_CODE, phoneWords, stageAt } from './ways';

const FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: DUR.short, ease: EASE_OUT } } as const;

const STEPS = ['Connect', 'Choose', 'Send'] as const;

function Steps({ at }: { readonly at: number }) {
  return (
    <ol aria-label="Steps" className="m-0 flex list-none gap-1 p-0">
      {STEPS.map((step, i) => (
        <li key={step} aria-current={i === at ? 'step' : undefined} className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn('h-1 rounded-pill', i <= at ? 'bg-teal-strong' : 'bg-rule-subtle')} />
          <span className={cn('text-[0.6875rem] leading-none font-semibold', i === at ? 'text-ink' : 'text-ink-3')}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function ChoiceButton({
  icon,
  title,
  note,
  strong,
  disabled,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly note: string;
  readonly strong: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-11 w-full items-center gap-2.5 rounded-2xl border px-3 py-1.5 text-start transition-[background-color,transform] duration-(--dur-micro) ease-(--ease-out)',
        'not-disabled:active:scale-[0.98] motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:border-rule-subtle disabled:bg-control disabled:text-ink-disabled',
        strong
          ? 'border-inverse bg-inverse text-on-inverse not-disabled:hover:bg-inverse/85'
          : 'border-rule bg-control text-ink not-disabled:hover:bg-control-hover',
      )}
    >
      <span aria-hidden className="inline-flex shrink-0 [&_svg]:size-4">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[0.8125rem] leading-tight font-semibold">{title}</span>
        <span className="text-[0.6875rem] leading-tight opacity-80">{note}</span>
      </span>
    </button>
  );
}

function Asking() {
  return (
    <div className="flex flex-col items-center gap-3 px-1 pt-2 text-center">
      <p className="m-0 text-[0.8125rem] leading-snug text-ink-2">On your computer, choose Allow to let this phone send videos.</p>
      <span translate="no" className="font-mono text-[2.5rem] leading-none font-medium tracking-[0.12em] text-ink tabular-nums">
        {MATCH_CODE}
      </span>
      <p className="m-0 text-[0.75rem] text-ink-2">Your computer shows the same number</p>
      <p className="m-0 inline-flex items-center gap-1.5 rounded-pill bg-sunken px-2.5 py-1.5 text-[0.75rem] font-semibold text-ink">
        <LoaderCircle aria-hidden className="size-3.5 shrink-0 text-teal-strong motion-safe:animate-spin" />
        Waiting for approval on your computer…
      </p>
    </div>
  );
}

function Denied({ onAgain }: { readonly onAgain: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-1 pt-6 text-center">
      <span translate="no" className="font-mono text-[2.5rem] leading-none font-medium tracking-[0.12em] text-ink-3 tabular-nums">
        {MATCH_CODE}
      </span>
      <p className="m-0 text-[0.8125rem] font-semibold text-ink">Your computer said no.</p>
      <button
        type="button"
        onClick={onAgain}
        className="inline-flex h-10 items-center gap-1.5 rounded-pill border border-rule bg-control px-4 text-[0.8125rem] font-semibold text-ink hover:bg-control-hover active:bg-control-pressed"
      >
        <RotateCcw aria-hidden className="size-3.5" />
        Ask again
      </button>
    </div>
  );
}

function Choose({ run }: { readonly run: WifiRun }) {
  const sent = run.arrivals.filter((a) => a.sentAt <= run.clock);
  const added = sent.filter((a) => stageAt(run.clock - a.sentAt) >= 2).length;
  const rows = [...sent].reverse().slice(0, 3);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <div className="flex flex-col gap-1">
        <p className="m-0 text-[0.9375rem] leading-tight font-bold text-ink">Choose videos</p>
        <p className="m-0 text-[0.6875rem] leading-snug text-ink-2">
          Files sends the original. Photos is quicker, but your iPhone may send a smaller copy.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <ChoiceButton
          icon={<FolderOpen />}
          title="Choose from Files"
          note="Original quality"
          strong
          disabled={!run.more}
          onClick={() => run.send('files')}
        />
        <ChoiceButton
          icon={<Images />}
          title="Choose from Photos"
          note="Quicker, may be a smaller copy"
          strong={false}
          disabled={!run.more}
          onClick={() => run.send('photos')}
        />
      </div>
      {sent.length > 0 ? (
        <div className="flex min-h-0 flex-col gap-1.5 border-t border-rule-subtle pt-2">
          <p className="m-0 text-[0.6875rem] font-semibold text-ink-2 tabular-nums">
            {added} of {sent.length} added
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            <AnimatePresence initial={false}>
              {rows.map((a) => {
                const clip = clipById(a.clipId);
                const stage = stageAt(run.clock - a.sentAt);
                return (
                  <motion.li
                    key={a.clipId}
                    layout="position"
                    initial={{ opacity: 0, y: -RISE }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: DUR.short, ease: EASE_OUT }}
                    className="flex items-center gap-2"
                  >
                    <ClipFrame sprite={clip.sprite} className="w-5 shrink-0 rounded-sm" />
                    <span className="min-w-0 flex-1 truncate text-[0.75rem] font-semibold text-ink">{clip.short}</span>
                    <span className={cn('shrink-0 text-[0.6875rem]', stage >= 2 ? 'font-semibold text-teal-strong' : 'text-ink-2')}>
                      {phoneWords(stage)}
                    </span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function PhoneSide({ run, className }: { readonly run: WifiRun; readonly className?: string }) {
  const step = run.answer === 'allowed' ? (run.arrivals.some((a) => a.sentAt <= run.clock) ? 2 : 1) : 0;
  return (
    <MotionConfig reducedMotion="user">
      <div
        role="group"
        aria-label="Your phone’s browser, open on Taalcut’s page"
        data-phone={run.answer}
        className={cn('relative aspect-[9/19] w-full rounded-[2.25rem] bg-viewer p-2 shadow-reel', className)}
      >
        <div className="flex size-full flex-col overflow-hidden rounded-[1.75rem] bg-canvas">
          <div aria-hidden className="flex h-8 shrink-0 items-center justify-center">
            <span className="h-4.5 w-16 rounded-pill bg-viewer" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 px-3.5 pb-3.5">
            <div className="flex items-center gap-2">
              <Logo kind="symbol" className="size-4" />
              <span className="text-[0.8125rem] font-semibold text-ink">Send videos</span>
            </div>
            <Steps at={step} />
            <AnimatePresence initial={false} mode="wait">
              <motion.div key={run.answer} {...FADE} className="flex min-h-0 flex-1 flex-col">
                {run.answer === 'asking' ? <Asking /> : null}
                {run.answer === 'denied' ? <Denied onAgain={run.askAgain} /> : null}
                {run.answer === 'allowed' ? <Choose run={run} /> : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
