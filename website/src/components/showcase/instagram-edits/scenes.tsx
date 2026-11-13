// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Sounds trending in Edits, the fact rows' scenes · mode: Persuade · system: WEB2 Remix Vernacular
 * one small scene per fact, acted out once on arrival and again under the pointer (vignette.tsx): the feed's tab
 *   gliding to Royalty-free and its sounds changing; a sound's playhead running to where its hook drops; the AI's
 *   vibe scores filling on three of your clips; the finished video staged in Edits with its captions and its sound
 * states: start · end (the server's and reduced motion's) · replay. Decorative, aria-hidden: the fact says it. */

import { Captions, Check, Music } from 'lucide-react';
import { useMemo } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { BrandIcon } from '#components/brand/brand-icon';
import { cn } from '#lib/cn';
import { ClipFrame } from '../frame';
import { frameOf } from '../frames';
import { act, beat, motion, pop, type Scene, SceneChip, VignetteFrame } from '../vignette';
import { hookLabel, hooksOf, soundById, waveOf } from './sounds';

/** Sounds: the tab's thumb glides from Trending to Royalty-free, and the list turns royalty-free. */
export function SoundsScene(scene: Scene) {
  const { reduce } = scene;
  const tabs = ['Trending', 'For You', 'Royalty-free'];
  const rows = [0.62, 0.48, 0.7];
  return (
    <VignetteFrame>
      <div className="absolute inset-x-4 top-3.5 flex justify-center">
        <span className="relative flex gap-0.5 rounded-pill bg-sunken p-0.5 text-[0.6875rem] font-semibold">
          <motion.span
            className="absolute top-0.5 left-0.5 h-6 w-[4.75rem] rounded-pill border border-rule-strong bg-raised shadow-xs"
            {...act(scene, { x: 0 }, { x: '205.3%' }, beat(0.3, reduce, 0.6))}
          />
          {tabs.map((t) => (
            <span key={t} className="relative z-10 inline-grid h-6 w-[4.75rem] place-items-center text-ink-2">
              {t}
            </span>
          ))}
        </span>
      </div>
      <div className="absolute inset-x-5 top-12 flex flex-col gap-1.5">
        {rows.map((w, i) => (
          <motion.span
            key={w}
            className="flex h-5 items-center gap-2"
            {...act(scene, { opacity: 0.35, x: -6 }, { opacity: 1, x: 0 }, beat(0.8 + i * 0.12, reduce, 0.35))}
          >
            <span className="inline-grid size-5 place-items-center rounded-sm bg-rose-soft text-rose-strong">
              <Music className="size-3" />
            </span>
            <span className="h-1.5 rounded-pill bg-rule" style={{ width: `${Math.round(w * 50)}%` }} />
            <motion.span
              className="ms-auto rounded-pill bg-teal-soft px-1.5 py-px text-[0.6875rem] font-semibold text-teal-strong"
              {...act(scene, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1 }, pop(1 + i * 0.14, reduce))}
            >
              Royalty-free
            </motion.span>
          </motion.span>
        ))}
      </div>
    </VignetteFrame>
  );
}

/** Hooks: the playhead runs along the sound to the rose band where its hook drops, and the time pops up. */
export function HooksScene(scene: Scene) {
  const { reduce } = scene;
  const sound = soundById('boarding');
  const bars = useMemo(() => waveOf(sound, 40), [sound]);
  const hook = hooksOf(sound)[0] ?? 3.5;
  const at = hook / sound.durationSec;
  return (
    <VignetteFrame>
      <div className="absolute inset-x-5 top-11 bottom-5">
        <span className="absolute inset-y-0 w-4 -translate-x-1/2 rounded-sm bg-rose-soft" style={{ left: `${at * 100}%` }} />
        <span className="absolute inset-0 flex items-center gap-px">
          {bars.map((b, i) => (
            <span
              key={i}
              className={cn('min-w-0 flex-1 rounded-pill', b.hook ? 'bg-rose-strong' : 'bg-rule-strong')}
              style={{ height: `${Math.round(b.level * 100)}%` }}
            />
          ))}
        </span>
        <span className="absolute inset-0">
          <motion.span className="absolute inset-0 block" {...act(scene, { x: '0%' }, { x: `${at * 100}%` }, beat(0.2, reduce, 1.1))}>
            <span className="absolute -inset-y-1 left-0 w-0.5 -translate-x-1/2 rounded-pill bg-playhead-strong" />
          </motion.span>
        </span>
      </div>
      <span className="absolute inset-x-5 top-3 h-6">
        <motion.span
          className="absolute top-0"
          style={{ left: `${at * 100}%` }}
          {...act(scene, { scale: 0, opacity: 0, y: 6 }, { scale: 1, opacity: 1, y: 0 }, pop(1.3, reduce))}
        >
          <span className="inline-flex -translate-x-1/3 rounded-pill bg-rose-soft px-2 py-0.5 text-[0.75rem] font-semibold whitespace-nowrap text-rose-strong">
            Hook drops <span className="ms-1 tc-mono">{hookLabel(hook)}</span>
          </span>
        </motion.span>
      </span>
    </VignetteFrame>
  );
}

/** Scores: three of your clips, each scored by Edits' on-device tools, the levels filling in turn. */
export function ScoresScene(scene: Scene) {
  const { reduce } = scene;
  const clips = [
    { id: 'repeat-09', level: 3 },
    { id: 'vietnam-08', level: 3 },
    { id: 'airport-04', level: 2 },
  ];
  return (
    <VignetteFrame>
      <div className="absolute inset-y-3 left-5 flex gap-2.5">
        {clips.map((c, i) => (
          <span key={c.id} className="flex h-full flex-col items-center gap-1.5">
            <ClipFrame sprite={frameOf(c.id)} className="h-[4.5rem] rounded-md" />
            <span className="flex items-end gap-px">
              {[0, 1, 2].map((k) => (
                <span key={k} className={cn('relative block w-1.5 overflow-hidden rounded-[1px] bg-rule', ['h-1.5', 'h-2', 'h-2.5'][k])}>
                  {k < c.level ? (
                    <motion.span
                      className="absolute inset-0 origin-bottom bg-violet-strong"
                      {...act(scene, { scaleY: 0 }, { scaleY: 1 }, beat(0.3 + i * 0.35 + k * 0.08, reduce, 0.25))}
                    />
                  ) : null}
                </span>
              ))}
            </span>
          </span>
        ))}
      </div>
      <motion.span
        className="absolute top-1/2 left-44 -translate-y-1/2"
        {...act(scene, { opacity: 0, x: 10 }, { opacity: 1, x: 0 }, beat(1.4, reduce, 0.4))}
      >
        <SceneChip className="bg-violet-soft text-[0.75rem] text-violet-strong shadow-none">
          <AiMark className="size-3.5" /> Vibe score
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}

/** Hand-off: the finished video slides into Edits on this Mac, captions still editable and the sound attached. */
export function HandoffScene(scene: Scene) {
  const { reduce } = scene;
  return (
    <VignetteFrame>
      <span className="absolute top-3 right-4 bottom-3 flex w-[45%] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-rule-strong">
        <SceneChip className="text-[0.75rem] shadow-none">
          <BrandIcon id="instagram" className="size-3.5" /> Instagram Edits
        </SceneChip>
        <motion.span
          className="inline-grid size-6 place-items-center rounded-pill bg-success-soft text-success-strong"
          {...act(scene, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1 }, pop(1.3, reduce))}
        >
          <Check className="size-3.5" strokeWidth={3} />
        </motion.span>
      </span>
      <motion.span
        className="absolute top-3 left-5 h-[6.5rem] overflow-hidden rounded-lg shadow-sticker"
        {...act(scene, { x: 0, rotate: 0 }, { x: 18, rotate: 3 }, beat(0.2, reduce, 0.7))}
      >
        <ClipFrame sprite={frameOf('repeat-11')} className="h-full rounded-none" />
        <span className="absolute inset-x-1.5 bottom-2 h-1.5 rounded-pill bg-viewer-ink/90" />
      </motion.span>
      <motion.span
        className="absolute bottom-3 left-[5.5rem]"
        {...act(scene, { opacity: 0, y: 8 }, { opacity: 1, y: 0, rotate: -3 }, pop(0.9, reduce))}
      >
        <SceneChip className="text-[0.6875rem]">
          <Captions /> Captions
        </SceneChip>
      </motion.span>
      <motion.span
        className="absolute top-5 left-[5.75rem]"
        {...act(scene, { opacity: 0, y: -8 }, { opacity: 1, y: 0, rotate: 3 }, pop(1.05, reduce))}
      >
        <SceneChip className="bg-rose-soft text-[0.6875rem] text-rose-strong shadow-none">
          <Music /> Sound
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}
