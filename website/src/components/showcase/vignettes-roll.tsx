// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the camera roll's vignettes (Your camera roll, sorted) · mode: Persuade · system: WEB2 Remix Vernacular
 * one small scene per fact, acted out once on arrival and again under the pointer (vignette.tsx): clips coming over
 *   Wi-Fi from a phone; a clip's frame and what the index notes in it; a search in plain words keeping the shots that
 *   match; a slot taking the AI's pick, with how sure it is and the other shots behind it
 * states: start · end (the server's and reduced motion's) · replay. Decorative, aria-hidden: the fact says it. */

import { Laptop, Mic, Search, Smartphone, Type, Wifi } from 'lucide-react';
import { AiMark } from '#components/brand/ai-mark';
import { cn } from '#lib/cn';
import { matchClips, SAMPLE_ROLL } from './auto-pick/roll';
import { ClipFrame } from './frame';
import { frameOf } from './frames';
import { act, beat, motion, pop, type Scene, SceneChip, VignetteFrame } from './vignette';

/** From: three clips leave the phone and land on the computer, over Wi-Fi. */
export function PhoneScene(scene: Scene) {
  const { reduce } = scene;
  const clips = ['repeat-02', 'repeat-08', 'repeat-15'];
  return (
    <VignetteFrame>
      <div className="absolute inset-0 flex items-center justify-between px-6">
        <span className="inline-grid h-20 w-11 place-items-center rounded-xl border-2 border-ink-2 bg-raised text-ink-2">
          <Smartphone className="size-4" />
        </span>
        <motion.span
          className="text-teal-strong"
          {...act(scene, { opacity: 0.2, scale: 0.8 }, { opacity: 1, scale: 1 }, beat(0.1, reduce, 0.5))}
        >
          <Wifi className="size-6" />
        </motion.span>
        <span className="relative inline-grid size-20 place-items-center rounded-2xl bg-raised text-ink-2 shadow-sticker">
          <Laptop className="size-8" strokeWidth={1.75} />
        </span>
      </div>
      {/* The way from the phone to the computer: each clip rides a full-width layer across it, by transform. */}
      <span className="absolute inset-y-0 right-[4.25rem] left-7">
        {clips.map((id, i) => (
          <motion.span
            key={id}
            className="absolute inset-0"
            {...act(
              scene,
              { x: '0%', opacity: 0 },
              { x: '100%', opacity: 1 },
              beat(0.3 + i * 0.25, reduce, 0.7),
            )}
          >
            <span
              className="absolute top-1/2 left-0 w-7"
              style={{
                transform: `translate(-50%, calc(-50% + ${(i - 1) * 6}px)) rotate(${(i - 1) * 8}deg)`,
              }}
            >
              <ClipFrame sprite={frameOf(id)} className="w-full rounded-sm shadow-sticker" />
            </span>
          </motion.span>
        ))}
      </span>
    </VignetteFrame>
  );
}

/** On your computer: a clip's frame, and what the index notes in it, popping beside it. */
export function IndexScene(scene: Scene) {
  const { reduce } = scene;
  const tags = [
    { key: 'l', body: <>train</>, x: 'left-24', y: 'top-4', r: -4 },
    { key: 'n', body: <>night</>, x: 'left-40', y: 'top-12', r: 3 },
    {
      key: 't',
      body: (
        <>
          <Type /> text
        </>
      ),
      x: 'left-24',
      y: 'top-20',
      r: 2,
    },
    {
      key: 's',
      body: (
        <>
          <Mic /> speech
        </>
      ),
      x: 'left-44',
      y: 'top-24',
      r: -3,
    },
  ];
  return (
    <VignetteFrame>
      <span className="absolute inset-y-3 left-5 aspect-[9/16]">
        <ClipFrame sprite={frameOf('repeat-13')} className="size-full rounded-lg" />
        {/* The scan passes down the clip and goes: it renders only once a run starts (the end state has none). */}
        {scene.ran ? (
          <motion.span
            className="absolute inset-x-0 top-0 h-0.5 rounded-pill bg-teal"
            {...act(
              scene,
              { y: 0, opacity: 1 },
              { y: 100, opacity: 0 },
              reduce
                ? { duration: 0.15 }
                : { duration: 0.9, ease: 'linear', opacity: { delay: 0.85, duration: 0.15 } },
            )}
          />
        ) : null}
      </span>
      {tags.map((t, i) => (
        <motion.span
          key={t.key}
          className={cn('absolute', t.x, t.y)}
          {...act(
            scene,
            { opacity: 0, scale: 0.5, rotate: 0 },
            { opacity: 1, scale: 1, rotate: t.r },
            pop(0.3 + i * 0.16, reduce),
          )}
        >
          <SceneChip className="text-[0.75rem]">{t.body}</SceneChip>
        </motion.span>
      ))}
    </VignetteFrame>
  );
}

/** The shots the search runs over: days and nights from all three trips, so the night ones stand out. */
const SEARCHED = ['repeat-03', 'vietnam-04', 'repeat-07', 'vietnam-08', 'airport-09', 'repeat-12', 'vietnam-13'];

/** Search: plain words keep the shots that match; the rest step back. */
export function SearchScene(scene: Scene) {
  const { reduce } = scene;
  const shown = SEARCHED.flatMap((id) => SAMPLE_ROLL.find((c) => c.id === id) ?? []);
  const hits = new Set(matchClips(shown, 'night').map((c) => c.id));
  return (
    <VignetteFrame>
      <span className="absolute inset-x-5 top-3.5 flex h-8 items-center gap-2 rounded-pill border border-rule-strong bg-canvas px-3 text-[0.8125rem] text-ink">
        <Search className="size-3.5 shrink-0 text-ink-3" />
        <motion.span {...act(scene, { opacity: 0 }, { opacity: 1 }, beat(0.15, reduce, 0.3))}>
          the night shots
        </motion.span>
      </span>
      <div className="absolute inset-x-5 bottom-3 flex gap-1.5">
        {shown.map((c, i) => {
          const hit = hits.has(c.id);
          return (
            <motion.span
              key={c.id}
              className={cn('relative min-w-0 flex-1 rounded-md', hit && 'ring-2 ring-teal')}
              {...act(
                scene,
                { opacity: 1, scale: 1 },
                hit ? { opacity: 1, scale: 1.04 } : { opacity: 0.25, scale: 0.9 },
                beat(0.55 + i * 0.05, reduce, 0.4),
              )}
            >
              <ClipFrame sprite={c.sprite} className="w-full rounded-md" />
            </motion.span>
          );
        })}
      </div>
    </VignetteFrame>
  );
}

/** Picks: a clip drops into its slot, the AI's chip and how sure it is pop beside it, the other shots behind. */
export function PickScene(scene: Scene) {
  const { reduce } = scene;
  return (
    <VignetteFrame>
      <span className="absolute top-3 bottom-3 left-6 aspect-[9/16] rounded-lg border-2 border-dashed border-rose p-0.5">
        <motion.span
          className="absolute inset-y-0.5 left-1/2 block aspect-[9/16] -translate-x-1/2"
          {...act(
            scene,
            { y: -70, opacity: 0, rotate: -8 },
            { y: 0, opacity: 1, rotate: 0 },
            beat(0.15, reduce, 0.55),
          )}
        >
          <ClipFrame sprite={frameOf('repeat-01')} className="size-full rounded-md" />
        </motion.span>
      </span>
      <motion.span
        className="absolute top-5 left-24"
        {...act(scene, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1 }, pop(0.65, reduce))}
      >
        <SceneChip className="bg-violet-soft text-violet-strong shadow-none">
          <AiMark className="size-3.5" /> AI pick
        </SceneChip>
      </motion.span>
      <span className="absolute top-14 left-24 flex items-end gap-0.5">
        {[0.5, 0.75, 1].map((h, i) => (
          <motion.span
            key={h}
            className="w-1.5 origin-bottom rounded-[2px] bg-ink-2"
            style={{ height: `${h * 0.85}rem` }}
            {...act(scene, { scaleY: 0 }, { scaleY: 1 }, beat(0.85 + i * 0.1, reduce, 0.3))}
          />
        ))}
        <span className="ms-1.5 text-[0.75rem] font-semibold text-ink">High</span>
      </span>
      <span className="absolute right-5 bottom-3 flex gap-1.5">
        {['repeat-14', 'vietnam-06', 'vietnam-03'].map((id, i) => (
          <motion.span
            key={id}
            className="w-8"
            {...act(
              scene,
              { opacity: 0, y: 10 },
              { opacity: 0.85, y: 0 },
              beat(1.1 + i * 0.08, reduce, 0.35),
            )}
          >
            <ClipFrame sprite={frameOf(id)} className="w-full rounded-sm" />
          </motion.span>
        ))}
      </span>
    </VignetteFrame>
  );
}
