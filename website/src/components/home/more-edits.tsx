// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: more ways · Sounds trending in Edits, drawn · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the run (more-kit): finished (Trending chosen, three sounds with their waveforms, each hook drop marked in
 *   seconds, the first sound picked with Cut with AI) · playing (the waveforms rise left to right, each hook mark drops
 *   onto its place, then Cut with AI pops on the first, about 2.5 s) · narrow tray (under 24 rem the live state leaves
 *   the caption row; under 20 rem the hook words fold to the mark). Decorative (aria-hidden).
 * The Trending sounds & hooks shelf as the app has it on Make, connected to Instagram Edits on the Mac: its tabs, its
 *   sounds as original audio, where each hook drops, and the AI's Cut with AI. */

import { AudioLines } from 'lucide-react';
import { motion } from 'motion/react';
import { AiMark } from '#components/brand/ai-mark';
import { BrandIcon } from '#components/brand/brand-icon';
import { MORE_WAYS } from '#content/home';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { Thumb } from './kit';
import { Tray } from './more-kit';
import { clipSprite } from './reel-data';
import { pop } from './tour-motion';

const W = MORE_WAYS.rows['instagram-edits'];
const BARS = 30;
/** The preview each sound plays, in seconds: the hook mark sits at its share of it. */
const PREVIEW = 16;
/** Each sound's cover, in W.sounds' order: the boarding queue, a night street, the climb out from a window seat. */
const COVERS = ['airport-06', 'repeat-13', 'airport-08'] as const;

/** A waveform's bar heights, 0.2 to 1: a fixed wave per sound (the server and the browser draw the same one). */
export function waveform(seed: number, count = BARS): number[] {
  return Array.from({ length: count }, (_, i) => {
    const v = Math.abs(Math.sin(i * 0.9 + seed * 1.7) * 0.6 + Math.sin(i * 0.37 + seed) * 0.4);
    return Math.round((0.2 + v * 0.8) * 100) / 100;
  });
}

function Wave({ seed, hook, row }: { readonly seed: number; readonly hook: number; readonly row: number }) {
  const at = 0.2 + row * 0.25;
  const share = hook / PREVIEW;
  return (
    <span className="relative flex h-8 min-w-0 flex-1 items-center gap-[2px]">
      {waveform(seed).map((h, i) => (
        <motion.span
          key={i}
          className={cn('min-w-0 flex-1 origin-center rounded-pill', i / BARS < share ? 'bg-ink-3' : 'bg-rose')}
          style={{ height: `${h * 100}%` }}
          variants={{ hidden: { scaleY: 0.1, transition: { duration: 0 } }, shown: { scaleY: 1, transition: { duration: 0.3, delay: at + i * 0.018 } } }}
        />
      ))}
      <motion.span
        className="absolute -top-1 -bottom-1 w-0.5 rounded-pill bg-rose-strong"
        style={{ left: `${share * 100}%` }}
        variants={{ hidden: { opacity: 0, y: -6, transition: { duration: 0 } }, shown: { opacity: 1, y: 0, transition: { duration: 0.3, delay: at + 0.7 } } }}
      />
    </span>
  );
}

export function EditsDrawing({ className }: { readonly className?: string }) {
  return (
    <Tray
      place={W.place}
      icon={<AudioLines strokeWidth={ICON_STROKE} />}
      end={
        <span data-slot="icon-text" className="inline-flex items-center gap-1.5">
          <BrandIcon id="instagram" className="size-3.5" />
          {W.live}
        </span>
      }
      className={className}
      bodyClassName="flex flex-col gap-3 p-4"
    >
      <span className="flex items-center gap-4 border-b border-rule-subtle type-caption">
        {W.tabs.map((tab, i) => (
          <span key={tab} className={cn('-mb-px border-b-2 pb-1.5', i === 0 ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-2')}>
            {tab}
          </span>
        ))}
      </span>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {W.sounds.map((sound, i) => (
          <li
            key={sound.title}
            className={cn('flex min-w-0 items-center gap-3 rounded-xl px-2.5 py-2', i === 0 ? 'bg-raised shadow-sm ring-1 ring-rule-subtle' : '')}
          >
            <Thumb sprite={clipSprite(COVERS[i]!)} className="aspect-square w-9 shrink-0 rounded-lg" />
            <span className="flex w-[6.5rem] min-w-0 shrink-0 flex-col @max-[22rem]:w-[5.5rem]">
              <span className="truncate type-caption font-semibold text-ink">{sound.title}</span>
              <span className="truncate type-caption text-ink-2">{W.artist}</span>
            </span>
            <Wave seed={i + 1} hook={sound.hook} row={i} />
            <span className="w-11 shrink-0 text-end type-caption font-semibold whitespace-nowrap text-rose-strong @max-[20rem]:hidden">{W.hook(sound.hook)}</span>
          </li>
        ))}
      </ul>
      <motion.span
        variants={pop(1.6)}
        className="inline-flex items-center gap-1.5 self-end rounded-pill bg-violet-soft px-3 py-1 type-caption font-semibold text-violet-strong"
      >
        <AiMark className="size-3.5" />
        {W.cut}
      </motion.span>
    </Tray>
  );
}
