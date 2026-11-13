// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: mascot (Kaatu) · genre: atmospheric studio app (brand moments) · system: DESIGN.md v0.3, UX4
 * states (moods): idle (turns to the pointer through in-between frames, blinks wherever it looks, an antic now and
 *   then: a snack, a yawn, a wave, a dance, a wonder, a wink, "action!") · thinking (looks up, nibbles, looks up the
 *   other way) · happy (grin, a hop) · oops (bashful, a droop) · sleep (nods off, zzz; wakes with a yawn) · poke (a
 *   hop and a reaction, a different one each time; four quick ones make it dizzy). A pointer resting on it makes
 *   it shy. Not a control: no hover style, focus, disabled or loading.
 * motion: frame swaps for the face and head, transform-only body moves (breath, lean toward where it looks, hop,
 *   sway, wobble) on the Web Animations API and motion. The breath is a CSS animation of transform (kaatu.css), so
 *   the compositor runs it and no style is recalculated per frame (UX4, audit P2-6); it holds while the window is
 *   inactive. It runs all the time, asleep too (a slower breath); only the working line (breathe off) and reduced
 *   motion keep it still. Reduced motion: no breath, lean, moves or antics; faces crossfade; thinking keeps going,
 *   slower. The companion is calm: it doesn't follow the pointer or lean, and its antics are rare.
 * Hallmark · pre-emit critique: P4 H4 E5 S5 R4 V5 */

import { useLingui } from '@lingui/react/macro';
import { Mascot } from '@taalcut-vendor/page-mascot/mascot';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { cn } from '#lib/cn';
import type { KaatuAntic } from './kaatu-acts';
import { facing, KAATU_SHEETS, locate, reactionOf, type MascotMood } from './kaatu-frames';
import { useKaatuShown } from './kaatu-presence';
import { useKaatuPlayer } from './use-kaatu-player';

export type { MascotMood };
export type { KaatuAntic };

/**
 * Kaatu's size in each place it appears, in CSS pixels (DESIGN.md, Mascot).
 * The atlases hold 240 px cells: sharp up to 120 px on a 2x screen.
 */
export const MASCOT_SIZES = {
  /** The agent's working line, beside 13 px text. */
  line: 32,
  /** Onboarding's step rail. */
  rail: 64,
  /** Beside an empty state's words. */
  empty: 64,
  /** Above a not-found or error message. */
  message: 80,
  /** Beside "Tell Taalcut what to make" on a new chat. */
  hero: 88,
  /** Settings › About, beside the logo. */
  about: 112,
  /** The companion at the sidebar's foot (UX4); 32 on the rail, scaled from its feet. */
  companion: 40,
  /** Beside a moment's one line: a wait, a success, a failure, a first-visit tip (UX4). */
  moment: 48,
} as const;

export type MascotSpot = keyof typeof MASCOT_SIZES;

/**
 * The drawing fills about the middle 60% of its cell. Pulling the box in by this
 * much on both sides lines the drawing, not the empty cell, up with a column's
 * edge and with the gap to its neighbour.
 */
const OPTICAL_INSET = 0.18;

/** How far Kaatu leans toward where it looks: a share of its size sideways, and degrees. */
const LEAN = { shift: 0.022, tilt: 1.6 } as const;
const LEAN_SPRING = { type: 'spring', stiffness: 260, damping: 22, mass: 0.7 } as const;

const SIDE: Record<string, number> = {
  left: -1,
  'up-left': -1,
  'down-left': -1,
  right: 1,
  'up-right': 1,
  'down-right': 1,
};

export interface KaatuProps {
  /** Where Kaatu sits; decides the size. */
  spot: MascotSpot;
  mood?: MascotMood;
  /**
   * Read the name to screen readers ("Kaatu, Taalcut's beaver"). Leave it off
   * where Kaatu is decorative, which is almost everywhere: it is then hidden.
   */
  labelled?: boolean;
  /** The breath, blinks, lean and antics, all the time. On by default; the working line turns them off. */
  breathe?: boolean;
  /**
   * Play this antic now (the dev kit's preview). Change `performKey` to play it again.
   */
  perform?: KaatuAntic;
  performKey?: number;
  /**
   * The companion's manner (UX4): it doesn't turn to the pointer or lean as it looks, and gets up to an antic only
   * now and then, so it lives at the edge of your eye without pulling it, and costs next to nothing while it waits.
   */
  calm?: boolean;
  className?: string;
}

/** The calm companion's antics: the first after a while, then rarely. */
const CALM_ANTICS = { first: [20_000, 40_000], every: [45_000, 90_000] } as const;

/**
 * Kaatu, Taalcut's beaver: the brand's mascot. The name comes from काटना,
 * "to cut": beavers cut, and Taalcut cuts clips to the beat. Kaatu wears the
 * Avartan ring as a collar.
 * Drawn as six 3x3 sprite sheets on page-mascot's stage (third_party/page-mascot):
 * the face and head change by swapping frames, the body by transforms.
 */
export function Kaatu(props: KaatuProps) {
  // Show Kaatu off (the preference, UX4): every decorative Kaatu goes and its words stay. About's, which is named,
  // stays: it is where Kaatu is introduced.
  const shown = useKaatuShown();
  if (!shown && !props.labelled) return null;
  return <KaatuFigure {...props} />;
}

function KaatuFigure({
  spot,
  mood = 'idle',
  labelled = false,
  breathe = true,
  perform,
  performKey,
  calm = false,
  className,
}: KaatuProps) {
  const { t } = useLingui();
  const reduce = useReducedMotion() ?? false;
  const stage = useRef<HTMLSpanElement>(null);
  const size = MASCOT_SIZES[spot];
  const player = useKaatuPlayer({
    mood,
    blink: breathe,
    antics: breathe,
    reduce,
    stage,
    ...(calm ? { anticTiming: CALM_ANTICS } : {}),
  });
  // Kaatu never freezes: asleep it keeps breathing, slower and deeper (kaatu.css).
  const breathing = breathe && !reduce;
  const direction = facing(player.frame);
  // The lean goes with the breath: not in the working line, where the look-and-nibble is the loader.
  // The calm companion and a moment don't lean either: each lean is a spring the main thread draws, frame by frame,
  // and a moment's thinking turns its head every beat for as long as the work runs (an import).
  const lean = reduce || !breathe || calm || spot === 'moment' ? 0 : (SIDE[direction] ?? 0);

  const { perform: play } = player;
  useEffect(() => {
    if (perform) play(perform);
  }, [perform, performKey, play]);

  return (
    <motion.span
      data-slot="mascot"
      data-spot={spot}
      data-mood={mood}
      data-breathing={breathing || undefined}
      className={cn('block shrink-0 origin-bottom', className)}
      style={{ width: size, height: size, marginInline: -Math.round(size * OPTICAL_INSET) }}
      // The lean is a spring when the head turns; the breath is the inner span's, on the compositor.
      animate={{ x: lean * size * LEAN.shift, rotate: lean * LEAN.tilt }}
      transition={{
        x: reduce ? { duration: 0 } : LEAN_SPRING,
        rotate: reduce ? { duration: 0 } : LEAN_SPRING,
      }}
    >
      <span
        data-slot="mascot-breath"
        {...(breathing ? { 'data-breath': mood === 'sleep' ? 'asleep' : 'awake' } : {})}
        className="block size-full origin-bottom"
      >
        <Mascot
          sheets={KAATU_SHEETS}
          frame={locate(player.frame)}
          size={size}
          track={!calm && (mood === 'idle' || mood === 'poke')}
          onLook={player.look}
          onPoke={player.poke}
          onHover={player.hover}
          stageRef={stage}
          data={{
            'data-mood': mood,
            'data-frame': player.frame,
            'data-direction': direction,
            'data-reaction': reactionOf(player.frame),
          }}
          {...(labelled ? { label: t`Kaatu, Taalcut’s beaver` } : {})}
        />
      </span>
    </motion.span>
  );
}
