// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: platform block · one platform on /download/, shown as Taalcut running on it
 * mode: Persuade · system: WEB2 Remix Vernacular (the coded app window as the product surface, its requirements as
 *   tilted stickers on its edges, the brand's SVGL icon in a sticker chip by its name)
 * states: arriving (below the fold: the words rise, then the window, then its stickers pop) · arrived (the server HTML,
 *   on screen at load, reduced motion) · yours (the visitor's platform: a "You're on a Mac" sticker, and the block
 *   moves to the top) · the window leans a few px toward a fine pointer; the join link is a secondary button (default
 *   · hover · focus · active). Alternate blocks put the window first on wide screens.
 * The stickers are decoration: the facts list beside the window says each requirement in full. */

import {
  ArrowRight,
  CalendarClock,
  Cpu,
  FileVideo,
  Gpu,
  HardDrive,
  MemoryStick,
  Monitor,
  Package,
  PartyPopper,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useRef } from 'react';
import { BrandIcon, type BrandIconId } from '#components/brand/brand-icon';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { PageArrival } from '#components/contact/page-arrival';
import { AppWindow } from '#components/ui/app-window';
import { ButtonLink } from '#components/ui/button';
import { Sticker, type StickerField } from '#components/ui/sticker';
import { PLATFORM_GETS, PLATFORMS, PLATFORMS_PAGE, type PlatformGlyph } from '#content/platforms';
import type { PlatformId } from '#content/schema';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { usePointerDrift } from '#lib/pointer';
import { MacMake, UbuntuMake } from './app-pages';
import { WindowsEmpty } from './windows-empty';

const BRANDS: Readonly<Record<PlatformId, BrandIconId>> = {
  macos: 'apple',
  ubuntu: 'ubuntu',
  windows: 'windows',
};

export const GLYPHS: Readonly<Record<PlatformGlyph, LucideIcon>> = {
  system: Monitor,
  chip: Cpu,
  memory: MemoryStick,
  space: HardDrive,
  package: Package,
  gpu: Gpu,
  file: FileVideo,
};

/** A requirement's glyph in the facts list, by its label. */
const FACT_GLYPHS: Readonly<Record<string, LucideIcon>> = {
  System: Monitor,
  Chip: Cpu,
  Memory: MemoryStick,
  Space: HardDrive,
  Processor: Cpu,
  Package: Package,
  'The agent on your computer': Gpu,
  Reels: FileVideo,
};

/** Where each requirement sticker hangs on the window, and its field and tilt: never past the window's sides. */
const STICKER_SPOTS: readonly { readonly at: string; readonly field: StickerField; readonly tilt: number }[] =
  [
    { at: '-top-4 start-3 sm:start-6', field: 'sky', tilt: -5 },
    { at: '-top-5 end-3 sm:end-8', field: 'pink', tilt: 4 },
    { at: '-bottom-4 start-4 sm:start-12', field: 'lime', tilt: 3 },
    // On a phone the window is narrow, so the last one drops below the third instead of beside it.
    { at: '-bottom-14 end-2 sm:-bottom-5 sm:end-6', field: 'violet', tilt: -4 },
  ];

function Lean({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionPref();
  const lean = usePointerDrift(ref, { enabled: !reduce, max: 5 });
  return (
    <motion.div ref={ref} style={{ x: lean.x, y: lean.y }}>
      {children}
    </motion.div>
  );
}

function PlatformWindow({ id }: { readonly id: PlatformId }) {
  const words = PLATFORMS_PAGE.platforms[id];
  if (id === 'windows') return <WindowsEmpty />;
  return (
    <AppWindow title={words.window} platform={id === 'macos' ? 'mac' : 'ubuntu'} area="make" size="md">
      {id === 'macos' ? <MacMake /> : <UbuntuMake />}
    </AppWindow>
  );
}

export function PlatformBlock({ id, yours }: { readonly id: PlatformId; readonly yours: boolean }) {
  const platform = PLATFORMS.find((p) => p.id === id)!;
  const words = PLATFORMS_PAGE.platforms[id];
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-platform={id}
      data-yours={yours || undefined}
      className="grid scroll-mt-24 grid-cols-1 items-center gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:group-[:nth-child(even)]/platform:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
    >
      <PageArrival className="flex min-w-0 flex-col gap-5">
        {yours ? (
          <span className="-mb-1 self-start">
            <Sticker field="lime" icon={PartyPopper} tilt={-4} size="lg">
              {words.yours}
            </Sticker>
          </span>
        ) : null}
        <h2
          id={headingId}
          data-slot="icon-text"
          className="m-0 flex items-center gap-4 type-site-headline text-ink"
        >
          <span
            aria-hidden
            className="inline-grid size-[clamp(3rem,2vw+2.25rem,4rem)] shrink-0 -rotate-6 place-items-center rounded-2xl bg-raised shadow-sticker ring-1 ring-rule-subtle"
          >
            <BrandIcon id={BRANDS[id]} className="size-1/2" />
          </span>
          <span className="min-w-0">{words.heading}</span>
        </h2>
        {'after' in words ? (
          <span className="self-start">
            <Sticker field="sky" icon={CalendarClock} tilt={2} size="lg">
              {words.after}
            </Sticker>
          </span>
        ) : null}
        <p className="m-0 max-w-[32em] type-site-lead text-ink-2">{platform.line}</p>
        {platform.requirements.length > 0 ? (
          <dl className="m-0 flex flex-col gap-3">
            {platform.requirements.map(([label, value]) => {
              const Icon = FACT_GLYPHS[label] ?? Monitor;
              return (
                <div key={label} className="flex flex-col">
                  <dt className="inline-flex items-center gap-2.5 type-meta text-ink-2">
                    <Icon aria-hidden strokeWidth={ICON_STROKE} className="size-4.5 shrink-0" />
                    {label}
                  </dt>
                  <dd className="m-0 ps-7 type-site-body text-ink">{value}</dd>
                </div>
              );
            })}
          </dl>
        ) : null}
        <p className="m-0 inline-flex items-start gap-3 type-site-body font-semibold text-ink">
          <Package
            aria-hidden
            strokeWidth={ICON_STROKE}
            className="mt-[0.2lh] size-5 shrink-0 text-teal-strong"
          />
          {PLATFORM_GETS[id]}
        </p>
        {id === 'windows' ? null : (
          <ButtonLink
            href={`/waitlist/?platform=${id}`}
            variant="secondary"
            size="lg"
            className="mt-1 self-start"
          >
            {words.join}
            <ArrowRight aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
          </ButtonLink>
        )}
      </PageArrival>
      <PageArrival
        delay={0.1}
        className={cn(
          'relative min-w-0',
          words.stickers.length > 3 && 'mb-10 sm:mb-0',
          'lg:group-[:nth-child(even)]/platform:order-first',
        )}
      >
        <Lean>
          <PlatformWindow id={id} />
        </Lean>
        {words.stickers.map((s, i) => {
          const spot = STICKER_SPOTS[i % STICKER_SPOTS.length]!;
          return (
            <span key={s.words} aria-hidden className={cn('pointer-events-none absolute z-10', spot.at)}>
              <Sticker field={spot.field} icon={GLYPHS[s.glyph]} tilt={spot.tilt} delay={0.25 + i * 0.08}>
                {s.words}
              </Sticker>
            </span>
          );
        })}
      </PageArrival>
    </section>
  );
}
