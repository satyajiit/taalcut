// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Plugins and other agents, the fact rows' scenes · mode: Persuade · system: WEB2 Remix Vernacular
 * one small scene per fact, acted out once on arrival and again under the pointer (vignette.tsx): a post approved,
 *   then scheduled through Postiz, and how it did rising; Instagram Edits turning Active, a sound's hook and a video
 *   staged; a plugin's views switching to Access and its kinds of access ticked; Claude Code given Edit and export,
 *   and its export still asking you
 * states: start · end (the server's and reduced motion's) · replay. Decorative, aria-hidden: the fact says it. */

import { CalendarClock, Check, ShieldCheck, Send } from 'lucide-react';
import { BrandIcon } from '#components/brand/brand-icon';
import { cn } from '#lib/cn';
import { ClipFrame } from '../frame';
import { frameOf } from '../frames';
import { act, beat, motion, pop, type Scene, SceneChip, VignetteFrame } from '../vignette';

/** Postiz: the post is approved, scheduled, and how it did rises in bars. */
export function PostizScene(scene: Scene) {
  const { reduce } = scene;
  const bars = [0.35, 0.6, 0.45, 0.85];
  return (
    <VignetteFrame>
      <span className="absolute top-3 left-5 flex items-start gap-2.5 rounded-xl bg-raised p-2 shadow-sticker">
        <ClipFrame sprite={frameOf('vietnam-05')} className="h-[4.5rem] rounded-md" />
        <span className="flex w-20 flex-col gap-1.5 pt-1">
          <span className="h-1.5 w-full rounded-pill bg-rule" />
          <span className="h-1.5 w-3/4 rounded-pill bg-rule" />
          <motion.span
            className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-pill bg-inverse px-2 py-0.5 text-[0.6875rem] font-semibold text-on-inverse"
            {...act(scene, { scale: 1 }, { scale: [1, 0.9, 1] }, reduce ? { duration: 0.15 } : { delay: 0.3, duration: 0.3 })}
          >
            <Check className="size-3" strokeWidth={3} /> Approve
          </motion.span>
        </span>
      </span>
      <motion.span
        className="absolute bottom-3 left-5"
        {...act(scene, { opacity: 0, y: 8 }, { opacity: 1, y: 0, rotate: -3 }, pop(0.8, reduce))}
      >
        <SceneChip className="text-[0.75rem]">
          <CalendarClock /> Scheduled in Postiz
        </SceneChip>
      </motion.span>
      <span className="absolute right-5 bottom-4 flex h-16 items-end gap-1.5">
        {bars.map((h, i) => (
          <motion.span
            key={h}
            className="w-3 origin-bottom rounded-t-sm bg-teal"
            style={{ height: `${h * 100}%` }}
            {...act(scene, { scaleY: 0 }, { scaleY: 1 }, beat(1.2 + i * 0.12, reduce, 0.4))}
          />
        ))}
      </span>
    </VignetteFrame>
  );
}

/** Instagram Edits: the plugin turns Active, a sound's hook is marked, and the video is staged in Edits. */
export function EditsPluginScene(scene: Scene) {
  const { reduce } = scene;
  const rhythm = [0.4, 0.55, 0.3, 0.7, 1, 1, 0.6, 0.45, 0.65, 0.35, 0.5, 0.75, 0.4, 0.55];
  return (
    <VignetteFrame>
      <span className="absolute inset-x-5 top-3 flex items-center gap-2 rounded-xl bg-raised px-2.5 py-2 shadow-sticker">
        <span data-slot="icon-text" className="inline-flex items-center gap-2 text-[0.8125rem] font-semibold text-ink">
          <BrandIcon id="instagram" className="size-4" /> Instagram Edits
        </span>
        <motion.span
          className="ms-auto rounded-pill bg-success-soft px-2 py-0.5 text-[0.6875rem] font-semibold text-success-strong"
          {...act(scene, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1 }, pop(0.4, reduce))}
        >
          Active
        </motion.span>
      </span>
      <span className="absolute bottom-4 left-5 flex h-9 w-[46%] items-end gap-0.5">
        {rhythm.map((h, i) => (
          <motion.span
            key={i}
            className={cn('flex-1 origin-bottom rounded-[2px]', i === 4 || i === 5 ? 'bg-rose-strong' : 'bg-rule-strong')}
            style={{ height: `${h * 100}%` }}
            {...act(scene, { scaleY: 0.3 }, { scaleY: 1 }, beat(0.6 + i * 0.03, reduce, 0.35))}
          />
        ))}
      </span>
      <motion.span
        className="absolute right-5 bottom-3.5"
        {...act(scene, { opacity: 0, x: -16 }, { opacity: 1, x: 0, rotate: 3 }, pop(1.3, reduce))}
      >
        <SceneChip className="text-[0.75rem]">
          <Send /> Staged in Edits
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}

/** Your say: the views glide from Connection to Access, and the kinds of access tick in turn. */
export function YourSayScene(scene: Scene) {
  const { reduce } = scene;
  const views = ['Connection', 'Access', 'Tools', 'Skills'];
  const rows = [0.7, 0.55, 0.62];
  return (
    <VignetteFrame>
      <span className="absolute inset-x-4 top-3 flex justify-center">
        <span className="relative flex gap-0.5 rounded-pill bg-sunken p-0.5 text-[0.6875rem] font-semibold">
          <motion.span
            className="absolute top-0.5 left-0.5 h-6 w-[4.25rem] rounded-pill border border-rule-strong bg-raised shadow-xs"
            {...act(scene, { x: 0 }, { x: '103%' }, beat(0.25, reduce, 0.45))}
          />
          {views.map((v) => (
            <span key={v} className="relative z-10 inline-grid h-6 w-[4.25rem] place-items-center text-ink-2">
              {v}
            </span>
          ))}
        </span>
      </span>
      <span className="absolute inset-x-6 top-12 flex flex-col gap-2">
        {rows.map((w, i) => (
          <span key={w} className="flex items-center gap-2.5">
            <span className="relative inline-grid size-4 place-items-center rounded-sm border-[1.5px] border-rule-strong bg-raised">
              <motion.span
                className="absolute -inset-[1.5px] inline-grid place-items-center rounded-sm bg-teal-strong text-teal-ink"
                {...act(scene, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1 }, pop(0.8 + i * 0.25, reduce))}
              >
                <Check className="size-3" strokeWidth={3} />
              </motion.span>
            </span>
            <span className="h-1.5 rounded-pill bg-rule" style={{ width: `${w * 100}%` }} />
          </span>
        ))}
      </span>
    </VignetteFrame>
  );
}

/** Other agents: Claude Code is given Edit and export, and its export still asks you. */
export function AgentsScene(scene: Scene) {
  const { reduce } = scene;
  const levels = ['Look only', 'Edit', 'Edit and export'];
  return (
    <VignetteFrame>
      <span className="absolute top-3 left-5 flex gap-1.5">
        <SceneChip className="text-[0.75rem]">
          <BrandIcon id="claude" className="size-3.5" /> Claude Code
        </SceneChip>
        <SceneChip className="text-[0.75rem] opacity-70">
          <BrandIcon id="codex" className="size-3.5" /> Codex
        </SceneChip>
      </span>
      <span className="absolute top-12 left-5 flex rounded-pill bg-sunken p-0.5 text-[0.6875rem] font-semibold">
        {levels.map((l, i) => {
          const last = i === levels.length - 1;
          // The thumb passes Look only and Edit on its way: those render only once a run starts (their end is hidden).
          const thumb = last
            ? act(scene, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1 }, pop(0.9, reduce))
            : act(
                scene,
                { opacity: i === 0 ? 1 : 0 },
                { opacity: i === 0 ? 0 : [0, 1, 0] },
                reduce ? { duration: 0.15 } : { delay: 0.35 + i * 0.25, duration: 0.45 },
              );
          return (
            <span key={l} className="relative inline-grid h-6 place-items-center px-2.5 whitespace-nowrap text-ink-2">
              {last || scene.ran ? (
                <motion.span className="absolute inset-0 rounded-pill border border-rule-strong bg-raised shadow-xs" {...thumb} />
              ) : null}
              <span className="relative">{l}</span>
            </span>
          );
        })}
      </span>
      <motion.span
        className="absolute right-5 bottom-3"
        {...act(scene, { opacity: 0, y: 10, scale: 0.8 }, { opacity: 1, y: 0, scale: 1, rotate: -3 }, pop(1.3, reduce))}
      >
        <SceneChip className="bg-sticker-sky text-[0.75rem] text-sticker-sky-ink">
          <ShieldCheck /> Export? It asks you
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}
