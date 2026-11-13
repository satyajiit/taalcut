// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: private by default · mode: Persuade (a quiet section after a dense one) · system: WEB2 Remix Vernacular
 * states: arrived (server HTML, on screen at load, reduced motion: every clip indexed here, the lock on) ·
 *   arriving (the clips take their teal "indexed here" ticks one by one, then the lock and its sticker pop, about
 *   2 s) · the link: default · hover · focus (kit)
 * Your clips stay on your computer: the coded app window's Library on the owner's footage, indexed on the computer,
 * a lock on the window's corner, and the ledger's privacy facts, each with its icon. */

import { Check, CloudOff, Folder, Hand, HardDrive, KeyRound, Lock, LockKeyhole, RefreshCw, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useRef } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { AppWindow } from '#components/ui/app-window';
import { type IconTone, IconText } from '#components/ui/icon-text';
import { Sticker } from '#components/ui/sticker';
import { PRIVATE_SECTION } from '#content/home';
import { useArrival } from '#lib/arrival';
import { ICON_STROKE } from '#lib/icons';
import { HomeSection } from './home-section';
import { MoreLink, Thumb } from './kit';
import { rollWall } from './reel-data';
import { pop } from './tour-motion';

const P = PRIVATE_SECTION;
const FACT_ICONS: readonly (readonly [LucideIcon, IconTone])[] = [
  [HardDrive, 'you'],
  [CloudOff, 'you'],
  [Hand, 'ai'],
  [KeyRound, 'muted'],
  [Lock, 'you'],
  [RefreshCw, 'muted'],
];
const CELLS = rollWall(15, 3);
const TICK = (i: number) => 0.3 + i * 0.08;
const LOCKED = TICK(CELLS.length) + 0.15;

function Library() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionPref();
  const state = useArrival(ref, { reduce, amount: 0.4 });
  const w = P.window;
  return (
    <motion.div ref={ref} initial={false} animate={state} className="relative mx-auto w-full max-w-[44rem] pt-6 pr-6">
      <AppWindow title={w.title} area="library" size="md" fit="fold">
        <div className="flex items-center gap-3 border-b border-rule-subtle px-4 py-3">
          <IconText icon={Folder} tone="you" className="type-label font-semibold text-ink">
            {w.place}
          </IconText>
          <span className="type-meta text-ink-2">{w.clips}</span>
          <span className="ms-auto inline-flex items-center gap-1.5 rounded-pill bg-teal-soft px-2.5 py-1 type-caption font-semibold text-teal-strong">
            <HardDrive aria-hidden strokeWidth={ICON_STROKE} className="size-3.5" />
            {w.indexed}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-2 p-4">
          {CELLS.map((cell, i) => (
            <span key={`${cell.sprite}-${i}`} className="relative block">
              <Thumb sprite={cell.sprite} className="aspect-[9/16] w-full rounded-md" />
              <motion.span
                variants={pop(TICK(i))}
                aria-hidden
                className="absolute right-1 bottom-1 inline-grid size-5 place-items-center rounded-full bg-teal text-teal-ink shadow-sm"
              >
                <Check strokeWidth={ICON_STROKE + 0.5} className="size-3" />
              </motion.span>
            </span>
          ))}
        </div>
      </AppWindow>
      <motion.span
        variants={pop(LOCKED)}
        aria-hidden
        className="absolute top-0 right-0 z-10 inline-grid size-16 rotate-6 place-items-center rounded-2xl bg-teal text-teal-ink shadow-sticker sm:size-20"
      >
        <LockKeyhole strokeWidth={ICON_STROKE} className="size-1/2" />
      </motion.span>
      <span className="pointer-events-none absolute -bottom-5 left-6 z-10">
        <Sticker field="teal" icon={Lock} tilt={-4} delay={LOCKED + 0.2} className="pointer-events-auto">
          {P.lock}
        </Sticker>
      </span>
    </motion.div>
  );
}

export function PrivateDefault() {
  return (
    <HomeSection
      id="private"
      heading={P.heading}
      lead={P.lead}
      flip
      split="5/7"
      tone="sunken"
      aside={
        <>
          <ul className="flex flex-col gap-3">
            {P.facts.map((fact, i) => {
              const [icon, tone] = FACT_ICONS[i] ?? [Check, 'muted'];
              return (
                <IconText key={fact} as="li" icon={icon} tone={tone} className="type-site-body text-ink">
                  {fact}
                </IconText>
              );
            })}
          </ul>
          <MoreLink href="/faq/#footage-leaves">{P.link}</MoreLink>
        </>
      }
    >
      <Library />
    </HomeSection>
  );
}
