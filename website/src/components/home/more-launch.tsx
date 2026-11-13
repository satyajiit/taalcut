// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: more ways · Product launch videos, drawn · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the run (more-kit): finished (the brief, the script's first scenes with their frames, the formats with
 *   Portrait chosen, and Approve script & design) · playing (the brief rises, the scenes follow one by one, the
 *   format is chosen, then Approve pops, about 3 s) · narrow tray (under 22 rem the scenes' frames fold away).
 *   Decorative (aria-hidden); its Approve is the ink pill a demo's approval takes.
 * Create › Product launch as the app has it: your video idea in a sentence, the script as numbered scenes for you to
 *   approve before anything is made, and the four output formats. The product is Taalcut, its scenes the owner's own
 *   footage. */

import { Check, Rocket } from 'lucide-react';
import { motion } from 'motion/react';
import { MORE_WAYS } from '#content/home';
import { ICON_STROKE } from '#lib/icons';
import { Thumb } from './kit';
import { Choice, Tray } from './more-kit';
import { clipSprite } from './reel-data';
import { pop, rise } from './tour-motion';

const W = MORE_WAYS.rows['launch-videos'];
const FRAMES = ['repeat-15', 'vietnam-12', 'vietnam-05'] as const;
const SCENE = (i: number) => 0.55 + i * 0.3;
const APPROVE = SCENE(3) + 0.35;

export function LaunchDrawing({ className }: { readonly className?: string }) {
  return (
    <Tray place={W.place} icon={<Rocket strokeWidth={ICON_STROKE} />} className={className} bodyClassName="flex flex-col gap-3 p-4">
      <motion.div variants={rise(0.1)} className="flex flex-col gap-1">
        <span className="type-caption font-semibold text-ink-2">{W.idea}</span>
        <span className="rounded-xl rounded-tl-sm bg-raised px-3 py-2 type-label-sm text-ink shadow-sm ring-1 ring-rule-subtle">{W.brief}</span>
      </motion.div>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {W.scenes.map((scene, i) => (
          <motion.li key={scene} variants={rise(SCENE(i))} className="flex min-w-0 items-center gap-2.5">
            <span className="inline-grid size-5 shrink-0 place-items-center rounded-md bg-violet-soft type-caption font-semibold text-violet-strong">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate type-caption text-ink">
              <span className="text-ink-2">{W.scene(i + 1)} · </span>
              {scene}
            </span>
            <Thumb sprite={clipSprite(FRAMES[i]!)} className="hidden aspect-video w-12 shrink-0 rounded-md @[22rem]:block" />
          </motion.li>
        ))}
      </ol>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <Choice options={W.formats} picked={1} at={SCENE(3)} />
        <motion.span
          variants={pop(APPROVE)}
          className="inline-flex h-7 items-center gap-1.5 rounded-pill bg-inverse px-3 type-caption font-semibold whitespace-nowrap text-on-inverse"
        >
          <Check strokeWidth={ICON_STROKE + 0.5} className="size-3.5" />
          {W.approve}
        </motion.span>
      </div>
    </Tray>
  );
}
