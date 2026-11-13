// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Phone over Wi-Fi, on the computer · mode: Operate · system: WEB2 Remix Vernacular (teal is yours; the
 *   demo's Allow is an ink pill: the page's one marigold fill is Download for Mac)
 * rebuilt lean from the app's Wi-Fi way (apps/renderer/src/features/library/phone/connect/pairing-hero.tsx,
 *   approval-dialog.tsx; packages/transfer/SPEC.md): the code to scan (the auto-pick page's drawn code, which is not a
 *   code: qr-pattern.ts) with the PIN for typing, then the computer's question when a phone scans it ("Allow iPhone to
 *   send videos?", the match code the phone shows too, the phone's address, Deny and Allow), then the clips arriving
 *   in the library, each at its own stage
 * states: asking (Deny and Allow: default, hover, focus, active) · allowed (Connected) · denied (the phone may ask
 *   again) · New code and PIN (quiet button) · Replay (quiet button) · the arrivals' own (arrivals.tsx). One polite
 *   status line says what the run is doing, once per change
 * motion: a new code crossfades; the question's answer crossfades into its line (--dur-short, ease-out); reduced
 *   motion: at once */

import { CircleCheck, CopyCheck, Smartphone, X } from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useState } from 'react';
import { buttonClasses } from '#components/ui/button-classes';
import { Sticker } from '#components/ui/sticker';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { EYES, QR_SIZE, qrModules, samplePin } from '../auto-pick/qr-pattern';
import { Chip } from '../chip';
import { SHOWCASE_ICONS } from '../icons';
import { Arrivals } from './arrivals';
import type { WifiRun } from './wifi-run';
import { MATCH_CODE, PHONE_ADDRESS, stageAt } from './ways';

const FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: DUR.short, ease: EASE_OUT } } as const;
const FIRST_SEED = 20261106;

function Code({ seed }: { readonly seed: number }) {
  return (
    <svg viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`} aria-hidden className="size-full fill-current text-ink">
      {EYES.map(([x, y]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
          <rect x={0.5} y={0.5} width={6} height={6} rx={1.6} fill="none" stroke="currentColor" strokeWidth={1} />
          <rect x={2} y={2} width={3} height={3} rx={0.8} />
        </g>
      ))}
      {qrModules(seed).map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 0.1} y={y + 0.1} width={0.8} height={0.8} rx={0.3} />
      ))}
    </svg>
  );
}

function Pairing() {
  const [seed, setSeed] = useState(FIRST_SEED);
  const pin = samplePin(seed);
  const New = SHOWCASE_ICONS.newCode;
  return (
    <div className="flex flex-col gap-4 @min-[34rem]:flex-row @min-[34rem]:items-start">
      <div className="relative size-28 shrink-0 rounded-xl border border-rule-subtle bg-canvas p-2">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div key={seed} {...FADE} className="size-full">
            <Code seed={seed} />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="m-0 type-card-title text-ink">Scan the code with your phone</p>
        <p className="m-0 max-w-prose type-body text-ink-2">
          Camera won’t scan? Open the address in the phone’s browser and type this PIN:
        </p>
        <p className="m-0 flex items-center gap-3">
          <span aria-hidden translate="no" className="flex gap-2.5 font-mono text-2xl leading-none font-medium text-ink tabular-nums">
            <span className="tracking-[0.12em]">{pin.slice(0, 3)}</span>
            <span className="tracking-[0.12em]">{pin.slice(3)}</span>
          </span>
          <span className="sr-only">PIN {pin.split('').join(' ')}</span>
          <button type="button" className={buttonClasses('quiet', 'md', '-ms-1')} onClick={() => setSeed((s) => s + 1)}>
            <New aria-hidden className="size-4" />
            New code and PIN
          </button>
        </p>
      </div>
    </div>
  );
}

function AllowButton({ onClick }: { readonly onClick: () => void }) {
  const Approve = SHOWCASE_ICONS.approve;
  return (
    <button
      type="button"
      className="inline-flex h-10 items-center gap-2 rounded-pill border border-inverse bg-inverse px-4 type-label font-semibold whitespace-nowrap text-on-inverse transition-[background-color,transform] duration-(--dur-micro) ease-(--ease-out) hover:bg-inverse/85 active:scale-[0.98] motion-reduce:active:scale-100"
      onClick={onClick}
    >
      <Approve aria-hidden className="size-4" />
      Allow
    </button>
  );
}

/** The answer's line: Deny and Allow while the phone asks, then what was chosen. */
function Answer({ run, compact }: { readonly run: WifiRun; readonly compact: boolean }) {
  return (
    <AnimatePresence initial={false} mode="wait">
      {run.answer === 'asking' ? (
        <motion.span key="ask" {...FADE} className="flex gap-2">
          {compact ? null : (
            <button type="button" className={buttonClasses('secondary', 'md')} onClick={() => run.answerPhone(false)}>
              <X aria-hidden className="size-4" />
              Deny
            </button>
          )}
          <AllowButton onClick={() => run.answerPhone(true)} />
        </motion.span>
      ) : run.answer === 'allowed' ? (
        <motion.span key="yes" {...FADE} className="me-auto">
          <Chip tone="success">
            <CircleCheck aria-hidden />
            Connected over your Wi-Fi
          </Chip>
        </motion.span>
      ) : (
        <motion.span key="no" {...FADE} className="me-auto type-body text-ink-2">
          You chose Deny. The phone can ask again.
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function Question({ run, compact }: { readonly run: WifiRun; readonly compact: boolean }) {
  const code = (
    <span
      data-slot="match-code"
      translate="no"
      className={cn(
        'font-mono leading-none font-medium tracking-[0.12em] tabular-nums',
        compact ? 'text-xl' : 'text-3xl',
        run.answer === 'asking' ? 'text-ink' : 'text-ink-3',
      )}
    >
      {MATCH_CODE}
    </span>
  );
  if (compact)
    return (
      <section
        aria-label="Allow iPhone to send videos?"
        data-slot="approval"
        data-answer={run.answer}
        className="flex min-h-14 flex-wrap items-center gap-3 rounded-xl border border-rule-subtle bg-raised px-3 py-2 shadow-xs"
      >
        <Smartphone aria-hidden className="size-4 shrink-0 text-teal-strong" />
        <span className="me-auto type-label text-ink">Allow iPhone to send videos?</span>
        {code}
        <Answer run={run} compact />
      </section>
    );
  return (
    <section
      aria-label="Allow iPhone to send videos?"
      data-slot="approval"
      data-answer={run.answer}
      className="relative flex flex-col gap-3 rounded-xl border border-rule-subtle bg-raised p-4 shadow-window"
    >
      <div className="flex flex-col gap-3 @min-[34rem]:flex-row @min-[34rem]:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="m-0 flex items-center gap-2 type-card-title text-ink">
            <Smartphone aria-hidden className="size-4 shrink-0 text-teal-strong" />
            Allow iPhone to send videos?
          </p>
          <p className="m-0 type-body text-ink-2">
            A phone on your network opened this computer’s QR code. Allow it only if it’s yours.
          </p>
          <p className="m-0 type-meta text-ink-3">The phone’s address: {PHONE_ADDRESS}</p>
        </div>
        <span className="flex shrink-0 flex-col items-start gap-1">
          <span className="type-caption text-ink-2">Your phone shows the same number:</span>
          {code}
        </span>
      </div>
      <div className="flex min-h-10 flex-wrap items-center justify-end gap-2">
        <Answer run={run} compact={false} />
      </div>
    </section>
  );
}

/** One line for assistive technology, changed only when the run reaches a new part. */
function said(run: WifiRun): string {
  if (run.answer === 'asking') return 'An iPhone is asking to send videos.';
  if (run.answer === 'denied') return 'You denied the iPhone.';
  const landed = run.arrivals.filter((a) => a.sentAt <= run.clock);
  const ready = landed.filter((a) => stageAt(run.clock - a.sentAt) >= 2).length;
  if (landed.length === 0) return 'Connected. Waiting for clips.';
  return ready === landed.length ? `${ready} clips available to edit.` : 'Clips arriving.';
}

export function WifiPanel({ run, compact = false }: { readonly run: WifiRun; readonly compact?: boolean }) {
  const Replay = SHOWCASE_ICONS.replay;
  const landed = run.arrivals.filter((a) => a.sentAt <= run.clock).length;
  return (
    <MotionConfig reducedMotion="user">
      <div ref={run.box} data-run={run.phase} className="flex flex-col gap-5">
        {compact ? null : <Pairing />}
        <Question run={run} compact={compact} />
        <section aria-label="Arriving in your library" className="relative flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h4 className="m-0 me-auto flex items-center gap-2 type-section text-ink">
              Arriving in your library
              <span className="type-meta font-normal text-ink-2 tabular-nums">
                {landed} {landed === 1 ? 'clip' : 'clips'}
              </span>
            </h4>
            <button type="button" className={buttonClasses('quiet', 'md')} onClick={run.replay}>
              <Replay aria-hidden className="size-4" />
              Replay
            </button>
          </div>
          <Arrivals arrivals={run.arrivals} clock={run.clock} ran={run.ran} compact={compact} max={compact ? 3 : 4} />
          {compact ? null : (
            <span className="pointer-events-none absolute -top-4 right-24 hidden @min-[40rem]:block [&>*]:pointer-events-auto">
              <Sticker field="lime" icon={CopyCheck} tilt={4} size="sm">
                Every copy checked
              </Sticker>
            </span>
          )}
          <p role="status" className="sr-only">
            {said(run)}
          </p>
        </section>
      </div>
    </MotionConfig>
  );
}
