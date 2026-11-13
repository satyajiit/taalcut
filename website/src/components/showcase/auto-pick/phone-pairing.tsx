// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: phone pairing, a sample · mode: Operate · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2
 * rebuilt lean from the app's pairing hero (apps/renderer/src/features/library/phone/connect/pairing-hero.tsx,
 *   steps.tsx, qr-code.tsx): the code on a flat canvas square with no border of its own, since it sits inside the
 *   plate (here a drawn pattern, hidden from assistive tech and labelled a sample, since a real code is made by the
 *   app), and the three steps as beats, numbered because people read them aloud: this step a marigold ring, those
 *   to come hollow, a hairline joining them. The PIN in JetBrains Mono in two groups of three. New code and PIN
 *   draws another sample
 * states: steps: current (aria-current="step") · next · New code and PIN: default, hover, focus, active
 *   (the quiet button's) · disabled/loading/error n/a (a sample made in the page)
 * motion: a new code and PIN crossfade (opacity, --dur-short); reduced motion: the 150 ms fade */

import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { buttonClasses } from '#components/ui/button';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { SHOWCASE_ICONS } from '../icons';
import { EYES, QR_SIZE, qrModules, samplePin } from './qr-pattern';

const FIRST_SEED = 20261105;

function Pattern({ seed }: { readonly seed: number }) {
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

function Step({ n, current = false, last = false, title, children }: { readonly n: number; readonly current?: boolean; readonly last?: boolean; readonly title: string; readonly children: ReactNode }) {
  return (
    <li aria-current={current ? 'step' : undefined} className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3.5">
      {last ? null : <span aria-hidden className="absolute top-8 -bottom-5 left-3.5 w-px bg-rule-subtle" />}
      <span
        aria-hidden
        className={cn(
          'flex size-7 items-center justify-center rounded-pill type-label tabular-nums',
          current ? 'border-2 border-primary-strong bg-raised text-ink' : 'border border-rule-strong bg-raised text-ink-2',
        )}
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5 pt-0.5">
        <p className="m-0 type-card-title text-ink">{title}</p>
        {children}
      </div>
    </li>
  );
}

export function PhonePairing() {
  const [seed, setSeed] = useState(FIRST_SEED);
  const pin = samplePin(seed);
  const New = SHOWCASE_ICONS.newCode;
  const fade = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: DUR.short, ease: EASE_OUT } };

  return (
    <div className="flex flex-col gap-6">
      <figure className="m-0 flex flex-col items-start gap-2.5">
        <div className="relative size-40 rounded-xl bg-canvas p-3">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div key={seed} {...fade} className="size-full">
              <Pattern seed={seed} />
            </motion.div>
          </AnimatePresence>
        </div>
        <figcaption className="type-meta text-ink-2">The pairing screen. The app makes a new code each time.</figcaption>
      </figure>
      <ol className="m-0 flex list-none flex-col gap-5 p-0">
        <Step n={1} current title="Scan the code with your phone">
          <p className="m-0 max-w-prose type-body text-ink-2">Camera won’t scan? Open the address in the phone’s browser and type this PIN:</p>
          <p className="m-0 flex font-mono text-3xl leading-none font-medium text-ink tabular-nums">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span key={pin} {...fade} aria-hidden translate="no" className="flex gap-3">
                <span className="tracking-[0.12em]">{pin.slice(0, 3)}</span>
                <span className="tracking-[0.12em]">{pin.slice(3)}</span>
              </motion.span>
            </AnimatePresence>
            <span className="sr-only">Pairing PIN {pin.split('').join(' ')}</span>
          </p>
        </Step>
        <Step n={2} title="Choose Allow here when Taalcut asks">
          <p className="m-0 max-w-prose type-body text-ink-2">A phone that scans the code waits for your Allow, so a photo of the code alone can’t connect.</p>
        </Step>
        <Step n={3} last title="Pick your clips">
          <p className="m-0 max-w-prose type-body text-ink-2">They come over your Wi-Fi, with nothing to install on the phone. Each one joins your library as it lands.</p>
        </Step>
      </ol>
      <button type="button" className={buttonClasses('quiet', 'md', 'w-fit -ms-3')} onClick={() => setSeed((s) => s + 1)}>
        <New aria-hidden className="size-4" />
        New code and PIN
      </button>
    </div>
  );
}
