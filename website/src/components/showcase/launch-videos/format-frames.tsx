// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: one video in its four shapes · mode: Operate · system: WEB2 Remix Vernacular
 * the launch video's frame in each output format the brief chose, side by side at equal area and level at their foot,
 *   so the same scene reads in 16:9, 9:16, 1:1 and 4:5 at once; each named for assistive technology and captioned
 *   with its format. On a narrow window they go two to a row
 * states: a scene (the frames cut to the next one together: it rises in, the last fades) · being designed (a violet
 *   sweep crosses each frame while production designs the scene: the AI at work) · playing (the picture drifts in) ·
 *   a format turned off in the brief (its frame leaves; the rest share the row) · still (the server HTML, reduced
 *   motion: the scene at rest, a 150 ms fade between scenes)
 * motion: transform and opacity; reduced motion: the fade alone */

import { AnimatePresence, motion } from 'motion/react';
import type { CSSProperties } from 'react';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { SceneFrame } from './scene-frame';
import { type Aspect, formatOf, frameShares, type Scene } from './story';

const SHAPE: Readonly<Record<Aspect, string>> = {
  '16:9': 'aspect-video',
  '9:16': 'aspect-[9/16]',
  '1:1': 'aspect-square',
  '4:5': 'aspect-[4/5]',
};

export function FormatFrames({
  formats,
  scene,
  index,
  words,
  live,
  designing,
  reduce,
  tallest = 260,
}: {
  readonly formats: readonly Aspect[];
  readonly scene: Scene;
  /** The scene's place in the video, 0 first. */
  readonly index: number;
  /** The words production made for it (the approved version). */
  readonly words: string;
  readonly live: boolean;
  /** Production is designing this scene now. */
  readonly designing: boolean;
  readonly reduce: boolean;
  /** The tallest a frame may be, in design px, when fewer formats leave room. */
  readonly tallest?: number;
}) {
  const row = frameShares(formats, false);
  const pairs = frameShares(formats, true);
  const gap = 'calc(var(--spacing) * 3)';
  const swap = reduce ? { duration: REDUCED_FADE } : { duration: DUR.long, ease: EASE_OUT };
  return (
    <div className="@container">
      <div className="flex flex-wrap items-end justify-center gap-3">
        {formats.map((id, i) => {
          const format = formatOf(id);
          const alone = formats.length % 2 === 1 && i === formats.length - 1;
          const style = {
            '--w-row': `calc((100% - ${gap} * ${formats.length - 1}) * ${row[i]})`,
            '--w-pair': alone ? `calc((100% - ${gap}) * ${pairs[i]! / 2})` : `calc((100% - ${gap}) * ${pairs[i]})`,
            maxWidth: `calc(var(--aw-px) * ${Math.round(tallest * format.ratio)})`,
          } as CSSProperties;
          return (
            <figure key={id} data-format={id} style={style} className="m-0 flex w-(--w-pair) flex-col gap-2 @min-[34rem]:w-(--w-row)">
              <div className={cn('relative w-full overflow-hidden rounded-lg shadow-sticker', SHAPE[id])}>
                <AnimatePresence initial={false}>
                  <motion.div
                    key={`${scene.id}-${words}`}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={swap}
                    className="absolute inset-0"
                  >
                    <SceneFrame
                      scene={scene}
                      words={words}
                      aspect={id}
                      live={live && !reduce}
                      label={`${format.label}, scene ${index + 1}: ${words}`}
                      className="size-full rounded-none"
                    />
                  </motion.div>
                </AnimatePresence>
                {designing && !reduce ? (
                  <motion.span
                    key={`sweep-${scene.id}`}
                    aria-hidden
                    data-sweep
                    initial={{ x: '-110%' }}
                    animate={{ x: '110%' }}
                    transition={{ duration: 0.32, ease: 'linear' }}
                    className="pointer-events-none absolute inset-y-0 left-0 w-full bg-linear-to-r from-transparent via-violet-soft/80 to-transparent"
                  />
                ) : null}
              </div>
              <figcaption aria-hidden className="type-meta text-center whitespace-nowrap text-ink-2">
                {format.label}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
