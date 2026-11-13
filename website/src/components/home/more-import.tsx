// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: more ways · Bring your footage in, drawn · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the run (more-kit): finished (three clips from the phone in the library, each at its own stage: Searchable,
 *   Available to edit, Checking the copy; the ways in listed under it) · playing (the phone's three picks tick on, the
 *   Wi-Fi mark pops, the clips land in the library one by one and their stages fill, then the ways in rise, about 3 s)
 *   · narrow tray (under 30 rem the phone folds away and the library takes the width). Decorative (aria-hidden).
 * Library › Import as the app has it: footage chosen on a phone over the same Wi-Fi, arriving as clips that are
 *   checked, then indexed, and every way in by the app's own name and glyph, the Mac's own grouped under Apple's mark. */

import { Cable, Camera, Check, Files, Folder, HardDrive, HardDriveDownload, Images, type LucideIcon, Smartphone, Wifi } from 'lucide-react';
import { motion } from 'motion/react';
import { BrandIcon } from '#components/brand/brand-icon';
import { MORE_WAYS } from '#content/home';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { Thumb } from './kit';
import { Tray } from './more-kit';
import { clipSprite } from './reel-data';
import { pop, rise } from './tour-motion';

const W = MORE_WAYS.rows.import;

/** The phone's grid: its own raw clips (the ones "Vietnam, on repeat" was cut from), the three chosen first in the library. */
const PHONE = ['repeat-04', 'repeat-01', 'repeat-07', 'repeat-02', 'repeat-05', 'repeat-09', 'repeat-10', 'repeat-03', 'repeat-08'] as const;
const CHOSEN = ['repeat-01', 'repeat-02', 'repeat-03'] as const;

/** Each way in's glyph, the app's own (library/imports/import-words.ts). */
const WAY_ICONS: Readonly<Record<string, LucideIcon>> = {
  'Phone over Wi-Fi': Smartphone,
  Files,
  Folder,
  'Phone on a cable': Cable,
  'Camera or card': Camera,
  DJI: Camera,
  Insta360: HardDrive,
  'Apple Photos': Images,
};

const LAND = (i: number) => 1 + i * 0.45;

function Way({ name, at }: { readonly name: string; readonly at: number }) {
  const Icon = WAY_ICONS[name] ?? Files;
  return (
    <motion.span variants={rise(at)} className="inline-flex items-center gap-1 rounded-pill bg-raised px-2 py-0.5 type-caption whitespace-nowrap text-ink shadow-sm ring-1 ring-rule-subtle">
      <Icon strokeWidth={ICON_STROKE} className="size-3.5 text-ink-2" />
      {name}
    </motion.span>
  );
}

/** Three steps of the copy's way into the library: checked, ready to edit, searchable. */
function Stage({ done, at }: { readonly done: number; readonly at: number }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {[0, 1, 2].map((n) => (
        <span key={n} className="relative h-1.5 w-3 overflow-hidden rounded-pill bg-rule">
          {n < done ? (
            <motion.span
              className="absolute inset-0 origin-left rounded-pill bg-teal"
              variants={{ hidden: { scaleX: 0, transition: { duration: 0 } }, shown: { scaleX: 1, transition: { duration: 0.25, delay: at + n * 0.18 } } }}
            />
          ) : null}
        </span>
      ))}
    </span>
  );
}

function Phone() {
  return (
    <div className="hidden flex-col items-center gap-2 @[30rem]:flex">
      <div className="w-[8.5rem] rounded-[1.6rem] border-2 border-ink-2 bg-raised p-1.5 shadow-sticker">
        <div className="mx-auto mb-1.5 h-1 w-8 rounded-pill bg-rule" />
        <div className="grid grid-cols-3 gap-0.5 overflow-hidden rounded-[1.1rem]">
          {PHONE.map((id) => {
            const at = CHOSEN.indexOf(id as (typeof CHOSEN)[number]);
            return (
              <Thumb key={id} sprite={clipSprite(id)} className="aspect-square w-full">
                {at >= 0 ? (
                  <motion.span variants={pop(0.2 + at * 0.15)} className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-teal text-teal-ink ring-2 ring-raised">
                    <Check strokeWidth={ICON_STROKE + 1} className="size-2.5" />
                  </motion.span>
                ) : null}
              </Thumb>
            );
          })}
        </div>
        <div className="mx-auto mt-1.5 h-1 w-10 rounded-pill bg-rule" />
      </div>
      <motion.span variants={pop(0.75)} className="inline-flex items-center gap-1 type-caption font-semibold text-teal-strong">
        <Wifi strokeWidth={ICON_STROKE} className="size-3.5" />
        {W.phone}
      </motion.span>
    </div>
  );
}

export function ImportDrawing({ className }: { readonly className?: string }) {
  return (
    <Tray place={W.place} icon={<HardDriveDownload strokeWidth={ICON_STROKE} />} className={className} bodyClassName="flex flex-col gap-5 p-4 @[30rem]:p-5">
      <div className="grid grid-cols-1 items-center gap-5 @[30rem]:grid-cols-[auto_minmax(0,1fr)]">
        <Phone />
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {CHOSEN.map((id, i) => (
            <motion.li
              key={id}
              variants={{
                hidden: { opacity: 0, x: -28, transition: { duration: 0 } },
                shown: { opacity: 1, x: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: LAND(i) } },
              }}
              className="flex min-w-0 items-center gap-3 rounded-xl bg-raised px-3 py-2 shadow-sm ring-1 ring-rule-subtle"
            >
              <Thumb sprite={clipSprite(id)} className="aspect-[9/16] w-7 shrink-0 rounded-md" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate type-label-sm font-semibold text-ink">{W.files[i]}</span>
                <span className={cn('truncate type-caption', i === 0 ? 'text-teal-strong' : 'text-ink-2')}>{W.stages[i]}</span>
              </span>
              <Stage done={3 - i} at={LAND(i) + 0.35} />
            </motion.li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {W.everywhere.map((name, i) => (
          <Way key={name} name={name} at={2.4 + i * 0.06} />
        ))}
        <motion.span
          variants={rise(2.6)}
          className="inline-flex flex-wrap items-center gap-1.5 rounded-2xl border border-dashed border-rule-strong px-2 py-1.5"
        >
          <span data-slot="icon-text" className="inline-flex items-center gap-1 px-1 type-caption font-semibold text-ink">
            <BrandIcon id="apple" className="size-3.5" />
            {W.mac}
          </span>
          {W.macWays.map((name, i) => (
            <Way key={name} name={name} at={2.7 + i * 0.06} />
          ))}
        </motion.span>
      </div>
    </Tray>
  );
}
