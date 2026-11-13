// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Reels become templates' vignettes · mode: Persuade · system: WEB2 Remix Vernacular (violet slots, rose
 *   beats, teal for your roll)
 * one small scene per fact, acted out once on arrival and again under the pointer (vignette.tsx): the saved reel's
 *   slot strip lifting off its frame with its beats and its words on screen; the starters fanning out as 9:16
 *   templates, each with its own rhythm; one template filled from one trip, then another, and waiting for the next
 * states: start · end (the server's and reduced motion's) · replay. Decorative, aria-hidden: the fact says it. */

import { AudioLines, Plus, Repeat, Type } from 'lucide-react';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { PosterFrame } from '../frame';
import { spriteStyle } from '../frames';
import { FORMAT_ICONS } from '../icons';
import { act, beat, motion, pop, type Scene, SceneChip, VignetteFrame } from '../vignette';
import { STARTERS } from './starters';
import { rollById, type RollId, stillOf, templateReel, templateSlots } from './template';

/** A template keeps: the reel's strip lifts off its frame and lands as the slots, the beats and the words on screen. */
export function KeepScene(scene: Scene) {
  const { reduce } = scene;
  const r = templateReel();
  const slots = templateSlots(r);
  return (
    <VignetteFrame>
      <div className="absolute inset-y-3 left-5 aspect-[9/16]">
        <PosterFrame src={r.poster} className="size-full rounded-lg" />
      </div>
      <motion.div
        className="absolute top-5 right-5 left-24 flex flex-col gap-2"
        {...act(
          scene,
          { x: -60, y: -6, opacity: 0, scale: 0.7 },
          { x: 0, y: 0, opacity: 1, scale: 1 },
          beat(0.15, reduce, 0.7),
        )}
      >
        <span className="flex gap-0.5">
          {slots.map((s) => (
            <span
              key={s.id}
              className="h-3 rounded-[2px] bg-violet"
              style={{ flexGrow: s.length, flexBasis: 0 }}
            />
          ))}
        </span>
        <span className="relative h-2">
          {r.beats.map((b) => (
            <span
              key={b}
              className="absolute top-0 h-2 w-0.5 rounded-pill bg-rose"
              style={{ left: `${(b / r.durationSec) * 100}%` }}
            />
          ))}
        </span>
      </motion.div>
      <motion.span
        className="absolute bottom-4 left-24"
        {...act(scene, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, pop(0.8, reduce))}
      >
        <SceneChip className="text-[0.75rem]">
          <Type /> Text and its timing
        </SceneChip>
      </motion.span>
      <motion.span
        className="absolute right-5 bottom-4"
        {...act(scene, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, pop(0.95, reduce))}
      >
        <SceneChip className="bg-rose-soft text-[0.75rem] text-rose-strong">
          <AudioLines /> Beats
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}

const FAN = [
  { id: 'weekend-trip', x: -112, y: 4, r: -12 },
  { id: 'quick-tip', x: -56, y: -6, r: -6 },
  { id: 'best-moments', x: 0, y: -10, r: 0 },
  { id: 'glow-up', x: 56, y: -6, r: 6 },
  { id: 'recipe-in-30-seconds', x: 112, y: 4, r: 12 },
] as const;

/** Starters: five 9:16 templates fan out from one stack, each with its own rhythm of slots. */
export function StartersScene(scene: Scene) {
  const { reduce } = scene;
  return (
    <VignetteFrame>
      <div className="absolute top-[54%] left-1/2">
        {FAN.map((f, i) => {
          const starter = STARTERS.find((s) => s.id === f.id);
          if (!starter) return null;
          const Icon = FORMAT_ICONS[starter.format];
          return (
            <motion.span
              key={f.id}
              className="absolute flex aspect-[9/16] w-13 -translate-x-1/2 -translate-y-1/2 flex-col gap-1 rounded-lg border border-rule-subtle bg-raised p-1.5 shadow-sticker"
              {...act(
                scene,
                { x: 0, y: 0, rotate: 0, opacity: 0, scale: 0.7 },
                { x: f.x, y: f.y, rotate: f.r, opacity: 1, scale: 1 },
                pop(0.1 + i * 0.08, reduce),
              )}
            >
              <Icon strokeWidth={ICON_STROKE} className="size-3 shrink-0 text-ink-2" />
              <span className="flex min-h-0 flex-1 flex-col gap-px">
                {starter.slots.map((s, j) => (
                  <span
                    key={j}
                    className={cn('block rounded-[1px]', j % 2 === 0 ? 'bg-violet' : 'bg-violet-soft')}
                    style={{ flexGrow: s, flexBasis: 0 }}
                  />
                ))}
              </span>
            </motion.span>
          );
        })}
      </div>
    </VignetteFrame>
  );
}

/** A template as small as a scene: its slots stacked by time, filled from a roll (or waiting, dashed). */
function MiniTemplate({
  scene,
  roll,
  at,
}: {
  readonly scene: Scene;
  readonly roll: RollId;
  readonly at: number;
}) {
  const slots = templateSlots();
  const picks = rollById(roll).picks;
  return (
    <span
      className={cn(
        'relative flex aspect-[9/16] h-full flex-col gap-px rounded-lg p-1',
        picks.length === 0
          ? 'border-[1.5px] border-dashed border-rule-strong bg-sunken'
          : 'border border-rule-subtle bg-panel shadow-sticker',
      )}
    >
      {slots.map((s, i) => {
        const still = stillOf(picks[i]?.clipId);
        return (
          <span
            key={s.id}
            className={cn(
              'relative block overflow-hidden rounded-[2px]',
              still === undefined ? 'border border-dashed border-violet' : 'bg-violet-soft',
            )}
            style={{ flexGrow: s.length, flexBasis: 0 }}
          >
            {still === undefined ? null : (
              <motion.span
                className="absolute inset-0 block"
                {...act(
                  scene,
                  { opacity: 0, scale: 0.6 },
                  { opacity: 1, scale: 1 },
                  beat(at + i * 0.12, scene.reduce, 0.3),
                )}
              >
                <span
                  data-frame="footage"
                  className="absolute inset-x-0 top-1/2 block aspect-[9/16] -translate-y-1/2"
                  style={spriteStyle(still)}
                />
              </motion.span>
            )}
          </span>
        );
      })}
      {picks.length === 0 ? (
        <span className="absolute inset-0 grid place-items-center text-ink-2">
          <Plus strokeWidth={ICON_STROKE} className="size-4" />
        </span>
      ) : null}
    </span>
  );
}

/** Reuse: one template filled from one trip, then from another, and waiting, dashed, for the next. */
export function RefillScene(scene: Scene) {
  const { reduce } = scene;
  return (
    <VignetteFrame>
      <div className="absolute inset-x-5 top-3 bottom-3 flex items-center justify-center gap-3">
        <MiniTemplate scene={scene} roll="flight" at={0.1} />
        <MiniTemplate scene={scene} roll="repeat" at={0.5} />
        <MiniTemplate scene={scene} roll="next" at={0} />
      </div>
      <motion.span
        className="absolute right-3 bottom-3"
        {...act(
          scene,
          { opacity: 0, scale: 0.5, rotate: -90 },
          { opacity: 1, scale: 1, rotate: 0 },
          pop(1.7, reduce),
        )}
      >
        <SceneChip>
          <Repeat /> Again
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}
