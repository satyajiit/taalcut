// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: meet Kaatu · mode: Persuade (delight) · system: WEB2 Remix Vernacular
 * states: resting (server HTML: Kaatu waving, big on its pink disc, three of its poses as photos pinned round it) · a
 *   trick (Poke Kaatu plays the next one: a wave, a think, a cheer, a bop, a snip, a doze, a clap, each a few seconds
 *   at most; its name pops as a sticker and is announced politely) · a photo is a button that plays its own trick
 *   (default: tilted · hover: straightens and lifts · focus: base ring · active: gives 3 % · playing: its trick is the
 *   one named, the photo sits level) · Kaatu itself: a tap is a poke (a laugh or a heart and a hop; a game, never a
 *   function) and it looks toward a near fine pointer · reduced motion (Kaatu's still frame for each trick; the name
 *   changes without a pop; the photos don't lift) · the Poke button: default · hover (surface) · focus (base ring) ·
 *   active (2 % give)
 * The mascot's own stage: its name from काटना, "to cut", Kaatu drawn from the 480 px atlases at about three quarters
 * of its disc, and three of its poses as photos at 120 px and more. Laid out in the stage's own width (a container),
 * the photos round the disc on a wide stage and in a row under it on a phone. Kaatu is decorative or a poke; the words
 * carry the meaning. */

import { Hand, Smile } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { Kaatu, type KaatuMood, type KaatuPose } from '#components/kaatu/kaatu';
import { buttonClasses } from '#components/ui/button-classes';
import { STICKER_FIELDS, Sticker, type StickerField } from '#components/ui/sticker';
import { KAATU_SECTION } from '#content/home';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { POP } from '#lib/motion';
import { HomeSection } from './home-section';

const K = KAATU_SECTION;

/** Each trick in KAATU_SECTION.tricks' order: a mood of its own, or a pose's act. */
const TRICKS: readonly ({ readonly mood: KaatuMood } | { readonly pose: KaatuPose })[] = [
  { mood: 'wave' },
  { mood: 'thinking' },
  { pose: 'cheer' },
  { pose: 'headphones' },
  { pose: 'snip' },
  { mood: 'asleep' },
  { pose: 'film' },
];

/**
 * The three photos: their pose, the trick a press plays, their field, and where each is pinned (in the stage's own
 * width, cqw): in a row under the disc on a phone, round the disc from a 36 rem stage.
 */
const PHOTOS: readonly { readonly pose: KaatuPose; readonly word: string; readonly field: StickerField; readonly place: string; readonly tilt: number }[] = [
  { pose: 'headphones', word: K.poses.headphones, field: 'pink', place: 'left-[1cqw] top-[92cqw] @xl:left-[1cqw] @xl:top-[5cqw]', tilt: -7 },
  { pose: 'snip', word: K.poses.snip, field: 'sky', place: 'left-[35cqw] top-[97cqw] @xl:right-[1cqw] @xl:left-auto @xl:top-[22cqw]', tilt: 6 },
  { pose: 'film', word: K.poses.film, field: 'lime', place: 'left-[69cqw] top-[92cqw] @xl:left-[6cqw] @xl:top-[49cqw]', tilt: -4 },
];
const trickOf = (pose: KaatuPose) => TRICKS.findIndex((t) => 'pose' in t && t.pose === pose);

/**
 * One pinned photo: a pose framed like a print (the drawing's own cell cropped to its subject: Kaatu fills 86 % of the
 * photo's height, so a 140 px photo shows it at 120 px), its caption sticker over the foot. A press plays its trick.
 */
function Photo({ photo, playing, onPlay }: { readonly photo: (typeof PHOTOS)[number]; readonly playing: boolean; readonly onPlay: () => void }) {
  return (
    <button
      type="button"
      onClick={onPlay}
      data-photo={photo.pose}
      data-playing={playing || undefined}
      style={{ rotate: `${playing ? 0 : photo.tilt}deg` }}
      className={cn(
        'absolute z-10 flex w-[30cqw] flex-col items-center rounded-2xl bg-raised p-[1.4cqw] pb-0 shadow-sticker ring-1 ring-rule-subtle @xl:w-[23cqw]',
        'transition-[rotate,translate,scale,box-shadow] duration-(--dur-short) ease-(--ease-out)',
        'hover:-translate-y-1 hover:rotate-0! hover:shadow-lift active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        playing && 'shadow-lift',
        photo.place,
      )}
    >
      <span aria-hidden className={cn('relative block aspect-square w-full overflow-hidden rounded-xl', STICKER_FIELDS[photo.field])}>
        {/* The cell is 139 % of the photo, nudged so the drawing's own margins fall outside the print. */}
        <span className="absolute top-[-11.1%] left-[-19.4%] size-[139%]">
          <Kaatu pose={photo.pose} className="[--kaatu-size:100%]" />
        </span>
      </span>
      <span className="-mt-[1.6cqw] mb-[-1.2cqw] inline-flex">
        <Sticker field={photo.field} size="sm" tilt={-photo.tilt / 2} pop={false}>
          {photo.word}
        </Sticker>
      </span>
    </button>
  );
}

function KaatuStage({ trick, pokes, onTrick }: { readonly trick: number; readonly pokes: number; readonly onTrick: (n: number) => void }) {
  const reduce = useReducedMotionPref();
  const t = TRICKS[trick]!;
  return (
    <div className="@container mx-auto w-full max-w-[46rem]">
      <div data-slot="kaatu-stage" className="relative aspect-[100/134] w-full @xl:aspect-[6/5]">
        <span aria-hidden className="absolute top-[8cqw] left-1/2 size-[78cqw] -translate-x-1/2 rounded-full bg-sticker-pink shadow-sticker @xl:top-[13cqw] @xl:size-[56cqw]" />
        <span aria-hidden className="absolute top-[15cqw] left-1/2 size-[64cqw] -translate-x-1/2 rounded-full border-2 border-dashed border-sticker-pink-ink/25 @xl:top-[18cqw] @xl:size-[46cqw]" />
        {/* Kaatu's cell is wider than the disc: the drawing fills about three quarters of the disc's height, its feet
            just inside the rim. */}
        <span className="absolute top-[11.6cqw] left-1/2 -translate-x-1/2 @xl:top-[14.8cqw]">
          <Kaatu
            {...('pose' in t ? { pose: t.pose } : { mood: t.mood })}
            interactive
            sticker
            className="[--kaatu-size:94cqw] @xl:[--kaatu-size:68cqw]"
          />
        </span>
        <span className="absolute top-[1cqw] left-1/2 z-20 -translate-x-1/2" aria-live="polite">
          <motion.span
            key={pokes}
            initial={pokes === 0 || reduce ? false : { scale: POP.scale, opacity: 0, rotate: -12 }}
            animate={{ scale: 1, opacity: 1, rotate: -3 }}
            transition={POP.spring}
            className="inline-block"
          >
            <Sticker field="violet" icon={Smile} size="lg" tilt={0} pop={false}>
              {K.tricks[trick]}
            </Sticker>
          </motion.span>
        </span>
        {PHOTOS.map((p) => {
          const n = trickOf(p.pose);
          return <Photo key={p.pose} photo={p} playing={pokes > 0 && trick === n} onPlay={() => onTrick(n)} />;
        })}
      </div>
    </div>
  );
}

export function MeetKaatu() {
  const [trick, setTrick] = useState(0);
  const [pokes, setPokes] = useState(0);
  const play = (n: number) => {
    setTrick(n);
    setPokes((p) => p + 1);
  };
  return (
    <HomeSection
      id="kaatu"
      heading={K.heading}
      split="5/7"
      tone="sunken"
      lead={
        <>
          <strong className="font-semibold text-ink">{K.name}</strong> {K.named}{' '}
          <span lang="hi" className="font-semibold text-ink">
            {K.word}
          </span>
          , {K.meaning}. {K.lead}
        </>
      }
      aside={
        <>
          <button type="button" onClick={() => play((trick + 1) % TRICKS.length)} className={buttonClasses('secondary', 'lg', 'self-start')}>
            <Hand aria-hidden strokeWidth={ICON_STROKE} className="size-5" />
            {K.poke}
          </button>
          <p className="type-label text-ink-2">{K.hint}</p>
        </>
      }
    >
      <KaatuStage trick={trick} pokes={pokes} onTrick={play} />
    </HomeSection>
  );
}
