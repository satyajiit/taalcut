// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a video per feature's fact scenes · mode: Persuade · system: WEB2 Remix Vernacular
 * for A video per feature, one small scene per fact, acted out once on arrival and again under the pointer
 *   (vignette.tsx): three ideas slide in, each one feature with a line quoted under it, and the days before a topic
 *   comes back; the week's research days ticking as the clock comes round to the set time; the strongest idea
 *   lifting into a video of the owner's footage, a limit a day and a budget beside it; a post approved, then
 *   scheduled through Postiz from its 4K master
 * states: start · end (the server's and reduced motion's) · replay. Decorative, aria-hidden: the fact says it. */

import { Check, Clock, Quote, Wallet } from 'lucide-react';
import { BrandIcon } from '#components/brand/brand-icon';
import { cn } from '#lib/cn';
import { ClipFrame } from '../frame';
import { frameOf } from '../frames';
import { act, beat, motion, pop, type Scene, SceneChip, VignetteFrame } from '../vignette';
import { WEEK } from './ideas';

/** Ideas: three cards slide in, one feature each, a quoted line under each; then the days before a topic returns. */
export function IdeasScene(scene: Scene) {
  const { reduce } = scene;
  const cards = ['Read any reel', 'Shorts', 'Sounds in Edits'];
  return (
    <VignetteFrame>
      <span className="absolute inset-x-4 top-3 flex flex-col gap-1.5">
        {cards.map((c, i) => (
          <motion.span
            key={c}
            className="flex h-8 items-center gap-2 rounded-lg bg-raised px-2 shadow-sticker"
            {...act(scene, { opacity: 0, x: 48 }, { opacity: 1, x: 0 }, beat(0.1 + i * 0.22, reduce, 0.45))}
          >
            <span className="rounded-pill bg-violet-soft px-1.5 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap text-violet-strong">{c}</span>
            <Quote className="size-3 shrink-0 text-violet-strong" />
            <span className={cn('h-1.5 rounded-pill bg-rule', ['w-16', 'w-12', 'w-14'][i])} />
          </motion.span>
        ))}
      </span>
      <motion.span
        className="absolute right-4 bottom-2"
        {...act(scene, { opacity: 0, scale: 0.6, rotate: 12 }, { opacity: 1, scale: 1, rotate: -4 }, pop(1, reduce))}
      >
        <SceneChip className="bg-sticker-lime text-[0.75rem] text-sticker-lime-ink">Again after 14 days</SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}

/** On a schedule: the clock comes round to the set time and the chosen days tick. */
export function ScheduleScene(scene: Scene) {
  const { reduce } = scene;
  const chosen = [1, 3, 5];
  return (
    <VignetteFrame>
      <span className="absolute top-4 left-4 inline-grid size-16 place-items-center rounded-pill border-2 border-ink bg-raised">
        <span className="absolute top-1/2 left-1/2 h-0.5 w-4 origin-left -translate-y-1/2 rounded-pill bg-ink" style={{ rotate: '180deg' }} />
        <motion.span
          className="absolute top-1/2 left-1/2 h-0.5 w-6 origin-left -translate-y-1/2 rounded-pill bg-teal-strong"
          {...act(scene, { rotate: -90 }, { rotate: 270 }, beat(0.1, reduce, 1.1))}
        />
        <span className="absolute size-1.5 rounded-pill bg-ink" />
      </span>
      <span className="absolute top-6 right-4 left-24 grid grid-cols-7 gap-1">
        {WEEK.map((w, i) => {
          const on = chosen.includes(w.day);
          return (
            <span key={w.day} className={cn('relative inline-grid h-9 place-items-center rounded-md text-[0.6875rem] font-semibold', on ? 'bg-teal-soft text-teal-strong' : 'bg-sunken text-ink-2')}>
              {w.short.slice(0, 1)}
              {on ? (
                <motion.span
                  className="absolute -top-1.5 -right-1.5 inline-grid size-4 place-items-center rounded-pill bg-teal-strong text-teal-strong-ink"
                  {...act(scene, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1 }, pop(0.5 + i * 0.12, reduce))}
                >
                  <Check className="size-2.5" strokeWidth={3} />
                </motion.span>
              ) : null}
            </span>
          );
        })}
      </span>
      <motion.span className="absolute right-4 bottom-3" {...act(scene, { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, beat(1.2, reduce, 0.4))}>
        <SceneChip className="text-[0.75rem]">
          <Clock /> 09:00, in the installed app
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}

/** Ready-made: the top idea lifts into a video of the owner's footage; a limit a day and a budget per video. */
export function ReadyScene(scene: Scene) {
  const { reduce } = scene;
  return (
    <VignetteFrame>
      <span className="absolute top-5 left-4 flex w-[42%] flex-col gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className={cn('flex h-6 items-center gap-1.5 rounded-md px-2', i === 0 ? 'bg-violet-soft' : 'bg-raised shadow-xs')}
            {...(i === 0 ? act(scene, { y: 0, scale: 1 }, { y: -4, scale: 1.04 }, beat(0.15, reduce, 0.4)) : {})}
          >
            <span className={cn('h-1.5 rounded-pill', i === 0 ? 'w-3/4 bg-violet-strong' : 'w-1/2 bg-rule')} />
          </motion.span>
        ))}
      </span>
      <motion.span
        className="absolute top-3 left-[calc(42%+2.25rem)] w-14"
        {...act(scene, { opacity: 0, x: -40, y: 10, scale: 0.6, rotate: -8 }, { opacity: 1, x: 0, y: 0, scale: 1, rotate: 3 }, pop(0.5, reduce))}
      >
        <ClipFrame sprite={frameOf('airport-08')} className="w-full rounded-lg shadow-sticker" />
      </motion.span>
      <span className="absolute right-4 bottom-3 flex flex-col items-end gap-1">
        <motion.span {...act(scene, { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, beat(1, reduce, 0.35))}>
          <SceneChip className="text-[0.75rem]">1 a day</SceneChip>
        </motion.span>
        <motion.span {...act(scene, { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, beat(1.15, reduce, 0.35))}>
          <SceneChip className="text-[0.75rem]">
            <Wallet /> 5.00 USD a video
          </SceneChip>
        </motion.span>
      </span>
    </VignetteFrame>
  );
}

/** Posting: the post waits, Approve is pressed, and it is scheduled through Postiz from the 4K master. */
export function PostScene(scene: Scene) {
  const { reduce } = scene;
  return (
    <VignetteFrame>
      <span className="absolute inset-y-3 left-4 flex w-[56%] flex-col gap-2 rounded-xl bg-raised p-2.5 shadow-sticker">
        <span className="flex items-center gap-1.5 text-[0.75rem] font-semibold text-ink">
          <BrandIcon id="instagram" className="size-3.5" />
          Instagram Reels
        </span>
        <span className="relative h-5">
          {scene.ran ? (
            <motion.span className="absolute inset-0 flex items-center text-[0.6875rem] font-semibold text-ink-2" {...act(scene, { opacity: 1 }, { opacity: 0 }, beat(0.75, reduce, 0.2))}>
              Awaiting approval
            </motion.span>
          ) : null}
          <motion.span
            className="absolute inset-0 flex items-center gap-1 text-[0.6875rem] font-semibold text-success-strong"
            {...act(scene, { opacity: 0, y: 4 }, { opacity: 1, y: 0 }, beat(0.95, reduce, 0.3))}
          >
            <Check className="size-3" strokeWidth={3} /> Scheduled
          </motion.span>
        </span>
        <motion.span
          className="w-fit rounded-pill bg-inverse px-2.5 py-1 text-[0.6875rem] font-semibold text-on-inverse"
          {...act(scene, { scale: 1 }, { scale: [1, 0.9, 1] }, reduce ? { duration: 0.15 } : { delay: 0.45, duration: 0.35, times: [0, 0.5, 1] })}
        >
          Approve
        </motion.span>
      </span>
      <span className="absolute top-4 right-4 flex flex-col items-end gap-1.5">
        <motion.span {...act(scene, { opacity: 0, x: 12 }, { opacity: 1, x: 0 }, beat(1.2, reduce, 0.35))}>
          <SceneChip className="bg-sticker-paper text-[0.75rem] text-sticker-paper-ink">4K master</SceneChip>
        </motion.span>
        <motion.span {...act(scene, { opacity: 0, x: 12 }, { opacity: 1, x: 0 }, beat(1.35, reduce, 0.35))}>
          <SceneChip className="text-[0.75rem]">via Postiz</SceneChip>
        </motion.span>
      </span>
    </VignetteFrame>
  );
}
