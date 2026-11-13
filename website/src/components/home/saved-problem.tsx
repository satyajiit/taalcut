// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the reel you saved (problem-saved) · mode: Persuade · system: WEB2 Remix Vernacular
 * states: awake (the finished state: server HTML, on screen at load, reduced motion: three saved reels fanned out,
 *   the front one playing, Kaatu up) · asleep (below the fold until it arrives: the reels in a neat pile and Kaatu
 *   napping on top) · waking (on arrival: a beat later the pile fans out on a spring and Kaatu jumps up) · spread
 *   (a fine pointer over the pile fans it wider) · Kaatu: a click is a poke (a game, never a function) · the front
 *   reel: its own Pause/Play (ReelFrame)
 * The reel you saved and never made: a pile of saved reels, each with its Saved bookmark, the front one the owner's
 * reel playing with its 13-slot bar, and Kaatu asleep on the pile until you scroll to it. */

import { BookmarkCheck, ClipboardPaste, Music, RectangleVertical } from 'lucide-react';
import { motion, useMotionValue } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { Kaatu } from '#components/kaatu/kaatu';
import { IconText } from '#components/ui/icon-text';
import { ReelFrame } from '#components/ui/reel-frame';
import { SegmentBar } from '#components/ui/segment-bar';
import { Sticker } from '#components/ui/sticker';
import { SAVED_PROBLEM } from '#content/home';
import { smallPoster } from '#content/reels';
import { useArrival } from '#lib/arrival';
import { ICON_STROKE } from '#lib/icons';
import { finePointer } from '#lib/pointer';
import { HomeSection } from './home-section';
import { Thumb } from './kit';
import { REEL, REEL_SEGMENTS } from './reel-data';

type Mode = 'pile' | 'fan' | 'wide';

/** Where each back reel sits, by mode: [x as a share of the card, y px, degrees]. */
const BACK: readonly Readonly<Record<Mode, readonly [number, number, number]>>[] = [
  { pile: [-3, 4, -3], fan: [-30, 18, -10], wide: [-38, 22, -13] },
  { pile: [3, 2, 2], fan: [28, 10, 8], wide: [36, 14, 11] },
];
/** Two more of the owner's shots, as the covers of two more saved reels (the neon heart, the lantern street). */
const BACK_SPRITES = [17, 44] as const;
const SPRING = { type: 'spring', stiffness: 170, damping: 19, mass: 0.9 } as const;
/** How long Kaatu naps on screen before the pile wakes. */
const WAKE_MS = 900;

function SavedChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill bg-viewer/70 px-2.5 py-1 type-caption font-semibold text-viewer-ink">
      <BookmarkCheck aria-hidden strokeWidth={ICON_STROKE} className="size-3.5" />
      {SAVED_PROBLEM.saved}
    </span>
  );
}

function BackReel({ sprite, place, mode }: { sprite: number; place: (typeof BACK)[number]; mode: Mode }) {
  const [x, y, rotate] = place[mode];
  return (
    <motion.div
      aria-hidden
      initial={false}
      animate={{ x: `${x}%`, y, rotate }}
      transition={SPRING}
      className="absolute inset-0 overflow-hidden rounded-reel shadow-reel"
    >
      <Thumb sprite={sprite} className="size-full" />
      <span className="absolute inset-x-3 top-3">
        <SegmentBar segments={REEL_SEGMENTS} state="filled" tone="video" decorative />
      </span>
      <span className="absolute bottom-4 left-3">
        <SavedChip />
      </span>
    </motion.div>
  );
}

function Pile() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce, amount: 0.5 });
  const [awake, setAwake] = useState(true);
  const [wide, setWide] = useState(false);
  const time = useMotionValue(0);

  useEffect(() => {
    if (arrival === 'hidden') {
      setAwake(false);
      return undefined;
    }
    if (awake) return undefined;
    const timer = window.setTimeout(() => setAwake(true), WAKE_MS);
    return () => window.clearTimeout(timer);
  }, [arrival, awake]);

  const mode: Mode = !awake ? 'pile' : wide ? 'wide' : 'fan';
  return (
    <div
      ref={ref}
      className="relative mx-auto w-[min(100%,12.5rem)] pt-[5rem] sm:w-64 lg:w-80"
      onPointerEnter={() => setWide(finePointer() && !reduce)}
      onPointerLeave={() => setWide(false)}
    >
      <span className="absolute top-0 left-1/2 z-40 -translate-x-1/2">
        <Kaatu pose={awake ? 'jump' : 'nap'} size={100} sticker interactive />
      </span>
      <div className="relative">
        {BACK_SPRITES.map((sprite, i) => (
          <BackReel key={sprite} sprite={sprite} place={BACK[i]!} mode={mode} />
        ))}
        <ReelFrame
          sources={REEL.reference}
          poster={smallPoster(REEL.id) ?? REEL.poster}
          label={SAVED_PROBLEM.label}
          time={time}
          bar={<SegmentBar segments={REEL_SEGMENTS} beats={REEL.beats} time={time} state="playing" tone="video" />}
          stickers={
            <>
              <span className="absolute top-[34%] -right-10 sm:-right-16">
                <Sticker field="pink" icon={Music} tilt={-6} delay={0.2}>
                  {SAVED_PROBLEM.stickers.beats}
                </Sticker>
              </span>
              <span className="absolute top-[52%] -left-8 sm:-left-14">
                <Sticker field="violet" icon={RectangleVertical} tilt={5} delay={0.35}>
                  {SAVED_PROBLEM.stickers.slots}
                </Sticker>
              </span>
            </>
          }
        >
          <span className="absolute bottom-4 left-3 z-10">
            <SavedChip />
          </span>
        </ReelFrame>
      </div>
    </div>
  );
}

export function SavedProblem() {
  return (
    <HomeSection
      id={SAVED_PROBLEM.id}
      heading={SAVED_PROBLEM.heading}
      lead={SAVED_PROBLEM.lead}
      tone="sunken"
      flip
      split="5/7"
      demoClassName="overflow-x-clip py-6 lg:overflow-visible"
      aside={
        <IconText icon={ClipboardPaste} tone="ai" size="lg" className="max-w-[30em] type-site-body font-semibold text-ink">
          {SAVED_PROBLEM.turn}
        </IconText>
      }
    >
      <Pile />
    </HomeSection>
  );
}
