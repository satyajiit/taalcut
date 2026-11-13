// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: shorts from long videos, its vignettes · mode: Persuade · system: WEB2 Remix Vernacular (violet is the
 *   AI's; the hook and the payoff in the slot-role hues, each with its word)
 * one small scene per fact, acted out once on arrival and again under the pointer (vignette.tsx): a video from the
 *   library, a file or a YouTube link becomes one long filmstrip; the length moves from 30 to 60 seconds and the short
 *   stops short of it; the AI marks a hook, the context and the payoff as whole sentences; the cut is checked against
 *   the original frames, fixed once, and passes
 * states: start · end (the server's and reduced motion's) · replay. Decorative, aria-hidden: the fact says it. */

import { CircleCheck, FileVideo, Film, Wrench } from 'lucide-react';
import { BrandIcon } from '#components/brand/brand-icon';
import { cn } from '#lib/cn';
import { ClipFrame } from '../frame';
import { frameOf, spriteStyle } from '../frames';
import { act, beat, motion, pop, type Scene, SceneChip, VignetteFrame } from '../vignette';
import { RoleGlyph, ROLE_LOOK } from './long-video';
import { SCENES } from './trip';

const STRIP = SCENES.filter((_, i) => i % 2 === 0).map((s) => s.clipId);

/** A long video's scenes end to end, square-cornered, the way the window draws it. */
function Strip({ className }: { readonly className?: string }) {
  return (
    <span className={cn('flex overflow-hidden rounded-md', className)}>
      {STRIP.map((id) => (
        <span key={id} className="block aspect-[9/16] min-w-0 flex-1 bg-viewer" data-frame="footage" style={spriteStyle(frameOf(id) ?? 0)} />
      ))}
    </span>
  );
}

/** From: the library, a file or a YouTube link, each becoming the long video. */
export function SourcesScene(scene: Scene) {
  const { reduce } = scene;
  const sources = [
    { key: 'library', body: <><Film /> Library</>, r: -4 },
    { key: 'file', body: <><FileVideo /> A file</>, r: 3 },
    { key: 'youtube', body: <><BrandIcon id="youtube" themeAware={false} className="size-3.5" /> YouTube</>, r: -2 },
  ];
  return (
    <VignetteFrame>
      <span className="absolute inset-x-5 top-3.5 flex justify-center gap-2">
        {sources.map((s, i) => (
          <motion.span key={s.key} {...act(scene, { opacity: 0, scale: 0.5, rotate: 0 }, { opacity: 1, scale: 1, rotate: s.r }, pop(0.15 + i * 0.14, reduce))}>
            <SceneChip className="text-[0.75rem]">{s.body}</SceneChip>
          </motion.span>
        ))}
      </span>
      <motion.span
        className="absolute inset-x-5 bottom-3 block origin-left"
        {...act(scene, { scaleX: 0.2, opacity: 0 }, { scaleX: 1, opacity: 1 }, beat(0.6, reduce, 0.7))}
      >
        <Strip />
      </motion.span>
    </VignetteFrame>
  );
}

/** Length: the choice moves from 30 to 60 seconds, and the short stops short of its target to end whole. */
export function LengthScene(scene: Scene) {
  const { reduce } = scene;
  const options = ['30 sec', '60 sec', '90 sec'];
  return (
    <VignetteFrame>
      <span className="absolute top-4 left-1/2 flex -translate-x-1/2 rounded-pill bg-sunken p-0.5 text-[0.75rem] font-semibold">
        <motion.span
          className="absolute inset-y-0.5 left-0.5 w-16 rounded-pill border border-rule-strong bg-raised shadow-xs"
          {...act(scene, { x: 0 }, { x: 64 }, beat(0.3, reduce, 0.45))}
        />
        {options.map((o) => (
          <span key={o} className="relative inline-flex h-7 w-16 items-center justify-center text-ink">
            {o}
          </span>
        ))}
      </span>
      <span className="absolute inset-x-6 bottom-5 h-3 rounded-pill bg-rule-subtle">
        <motion.span
          className="absolute inset-y-0 left-0 w-[63%] origin-left rounded-pill border border-violet-strong bg-violet-soft"
          {...act(scene, { scaleX: 0.5 }, { scaleX: 1 }, beat(0.7, reduce, 0.6))}
        />
        <span className="absolute -top-1.5 -bottom-1.5 left-[66%] w-0 border-s-2 border-dashed border-ink-3" />
        <motion.span className="absolute -top-7 left-[63%] -translate-x-full" {...act(scene, { opacity: 0, y: 4 }, { opacity: 1, y: 0 }, beat(1.2, reduce, 0.3))}>
          <span className="font-mono text-[0.75rem] font-semibold text-ink">0:59</span>
        </motion.span>
      </span>
    </VignetteFrame>
  );
}

/** It picks: whole sentences along the long video, marked hook, context and payoff. */
export function PicksScene(scene: Scene) {
  const { reduce } = scene;
  const marks = [
    { role: 'hook', left: '0%', width: '18%' },
    { role: 'context', left: '40%', width: '18%' },
    { role: 'payoff', left: '82%', width: '18%' },
  ] as const;
  return (
    <VignetteFrame>
      <span className="absolute inset-x-5 top-3 flex flex-col gap-1.5">
        <span className="relative block h-5">
          {marks.map((m, i) => {
            const look = ROLE_LOOK[m.role];
            return (
              <motion.span
                key={m.role}
                className={cn('absolute top-0', m.role === 'payoff' && 'right-0')}
                style={m.role === 'payoff' ? undefined : { left: m.left }}
                {...act(scene, { opacity: 0, y: 6 }, { opacity: 1, y: 0 }, beat(0.4 + i * 0.3, reduce, 0.3))}
              >
                <span className={cn('inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap [&_svg]:size-3', look.tag)}>
                  <RoleGlyph role={m.role} />
                  {look.word}
                </span>
              </motion.span>
            );
          })}
        </span>
        <Strip />
        <span className="relative block h-4">
          {marks.map((m, i) => (
            <motion.span
              key={m.role}
              className={cn('absolute inset-y-0 rounded-sm border-2', ROLE_LOOK[m.role].bar)}
              style={{ left: m.left, width: m.width }}
              {...act(scene, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, pop(0.3 + i * 0.3, reduce))}
            />
          ))}
        </span>
      </span>
    </VignetteFrame>
  );
}

/** The shot the check compares: a person on the pier, whom Smart reframe keeps in the portrait frame. */
const CHECKED = 'repeat-10';

/** Before you see it: the cut against the original frames, fixed once, then checked. */
export function CheckScene(scene: Scene) {
  const { reduce } = scene;
  return (
    <VignetteFrame>
      <span className="absolute top-3 bottom-3 left-6 flex gap-2">
        {[CHECKED, CHECKED].map((id, i) => (
          <span key={i} className="relative flex h-full flex-col items-center gap-1">
            <ClipFrame sprite={frameOf(id)} className="w-11 rounded-md" />
            <span className="text-[0.6875rem] leading-none font-semibold text-ink-2">{i === 0 ? 'Cut' : 'Original'}</span>
          </span>
        ))}
        {scene.ran ? (
          <motion.span
            className="absolute inset-x-0 top-0 h-0.5 rounded-pill bg-violet-strong"
            {...act(scene, { y: 0, opacity: 1 }, { y: 84, opacity: 0 }, reduce ? { duration: 0.15 } : { duration: 0.8, ease: 'linear', opacity: { delay: 0.75, duration: 0.15 } })}
          />
        ) : null}
      </span>
      <motion.span className="absolute top-5 right-5" {...act(scene, { opacity: 0, scale: 0.5, rotate: 0 }, { opacity: 1, scale: 1, rotate: -3 }, pop(0.85, reduce))}>
        <SceneChip>
          <Wrench /> Fixed once
        </SceneChip>
      </motion.span>
      <motion.span className="absolute right-6 bottom-5" {...act(scene, { opacity: 0, scale: 0.5, rotate: 0 }, { opacity: 1, scale: 1, rotate: 2 }, pop(1.25, reduce))}>
        <SceneChip className="bg-success-soft text-success-strong shadow-none">
          <CircleCheck /> Checked
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}
