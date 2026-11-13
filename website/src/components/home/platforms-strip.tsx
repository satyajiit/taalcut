// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: platforms · mode: Persuade (a quiet strip) · system: WEB2 Remix Vernacular
 * states: arrived (server HTML, reduced motion) · arriving (the words rise, then the three stickers pop in turn with
 *   the section) · each sticker is a link to its platform on /download/: default (tilted on its field) · hover (it
 *   straightens and lifts) · focus (base ring) · active (gives 3 %) · reduced motion (no lift, no pop) · the link
 *   onward: default · hover · focus (kit)
 * Apple, Ubuntu and Windows as /download/'s tilted platform stickers (the real SVGL icon and the name), each with the
 * one line it needs or where it stands, in a hand-placed run beside the words: no cards, no "Supported" badge (the
 * Mac has the download; Ubuntu and Windows have none yet, said in ink-3), and the way to /download/. */

import { Cpu, Hourglass, Timer, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { BrandIcon, type BrandIconId } from '#components/brand/brand-icon';
import { IconText } from '#components/ui/icon-text';
import { PLATFORMS_SECTION } from '#content/home';
import type { PlatformId } from '#content/schema';
import { cn } from '#lib/cn';
import { HomeSection } from './home-section';
import { MoreLink } from './kit';
import { pop } from './tour-motion';

const P = PLATFORMS_SECTION;

/** /download/'s platform stickers (platform-jump.tsx): the same fields and tilts, a step larger, set in a staggered run. */
const STICKERS: readonly {
  readonly id: PlatformId;
  readonly brand: BrandIconId;
  readonly need: LucideIcon;
  readonly face: string;
  readonly tilt: string;
  readonly place: string;
}[] = [
  { id: 'macos', brand: 'apple', need: Cpu, face: 'bg-sticker-sky text-sticker-sky-ink', tilt: '-rotate-3', place: 'sm:pt-0' },
  { id: 'ubuntu', brand: 'ubuntu', need: Hourglass, face: 'bg-sticker-paper text-sticker-paper-ink', tilt: 'rotate-2', place: 'sm:pt-14' },
  { id: 'windows', brand: 'windows', need: Timer, face: 'bg-sticker-violet text-sticker-violet-ink', tilt: '-rotate-2', place: 'sm:pt-5' },
];

function PlatformStickers() {
  return (
    <ul className="m-0 grid list-none grid-cols-1 gap-x-8 gap-y-8 p-0 sm:grid-cols-3">
      {STICKERS.map((s, i) => (
        <motion.li key={s.id} data-platform={s.id} variants={pop(0.15 + i * 0.1)} className={cn('flex min-w-0 flex-col items-start gap-4', s.place)}>
          <a
            href={`/download/#${s.id}`}
            className={cn(
              'inline-flex h-14 items-center gap-3 rounded-pill px-6 type-sticker whitespace-nowrap shadow-sticker select-none [font-size:clamp(1.0625rem,0.6vw+0.9rem,1.375rem)]',
              'transition-[rotate,translate,scale] duration-(--dur-short) ease-(--ease-out)',
              'hover:-translate-y-0.5 hover:rotate-0 active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:translate-y-0',
              s.face,
              s.tilt,
            )}
          >
            <BrandIcon id={s.brand} themeAware={false} className="size-6" />
            {P.names[s.id]}
          </a>
          <IconText icon={s.need} tone={s.id === 'macos' ? 'you' : 'muted'} className="max-w-[18em] ps-2 type-site-body text-ink">
            {P.needs[s.id]}
          </IconText>
        </motion.li>
      ))}
    </ul>
  );
}

export function PlatformsStrip() {
  return (
    <HomeSection id="platforms" heading={P.heading} lead={P.lead} split="5/7" aside={<MoreLink href="/download/">{P.link}</MoreLink>}>
      <PlatformStickers />
    </HomeSection>
  );
}
