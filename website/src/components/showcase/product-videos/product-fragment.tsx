// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a video per feature, the index fragment · mode: Operate · system: WEB2 Remix Vernacular
 * a small working piece of the Products showcase for /features/: Taalcut's video ideas as three 9:16 reels of the
 *   owner's footage, each one feature; choose one and the line from taalcut.app behind it shows under the row; Find
 *   video ideas researches again and brings ideas about other features
 * states: a reel: chosen (a teal ring, pressed, its line below) · not · hover and focus (its loop plays) · active ·
 *   researching (Find video ideas busy, the reels wait as dashed frames) · ideas (the server HTML, reduced motion:
 *   the first round, the first idea chosen)
 * motion: the line crossfades as the choice changes, the reels rise in after research (--dur-short, ease-out);
 *   reduced motion: the 150 ms fade */

import { Globe, Quote, ScanSearch } from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Logo } from '#components/brand/logo';
import { AppWindow } from '#components/ui/app-window';
import { buttonClasses } from '#components/ui/button-classes';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { DUR, EASE_OUT, RISE } from '#lib/motion';
import { ShowcasePlate } from '../plate';
import { prefersReducedMotion } from '../use-arrival';
import { ClipLoop } from './clip-reel';
import { batchOf, featureName } from './ideas';
import { LOOK } from './meta';

const FADE = { duration: DUR.short, ease: EASE_OUT } as const;

export function ProductFragment() {
  const [round, setRound] = useState(0);
  const [chosen, setChosen] = useState(0);
  const [researching, setResearching] = useState(false);
  const [near, setNear] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const ideas = batchOf(round);
  const idea = ideas[chosen] ?? ideas[0]!;
  const line = idea.evidence[0]!;
  const find = () => {
    setRound((r) => r + 1);
    setChosen(0);
    if (prefersReducedMotion()) return;
    setResearching(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setResearching(false), 800);
  };
  return (
    <MotionConfig reducedMotion="user">
      <AppWindow title="Products" area={LOOK.area} size="md" fit="fluid">
        <ShowcasePlate
          slug="product-videos-fragment"
          label="Taalcut’s video ideas, each backed by lines from taalcut.app"
          className="flex flex-col gap-4"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Logo kind="symbol" className="size-6" />
            <h3 className="m-0 me-auto type-section text-ink">Taalcut · Ideas</h3>
            <button
              type="button"
              className={buttonClasses('secondary', 'md')}
              aria-busy={researching || undefined}
              disabled={researching}
              onClick={find}
            >
              <ScanSearch aria-hidden className={cn('size-4', researching && 'animate-pulse')} />
              Find video ideas
            </button>
          </div>
          <p role="status" className="sr-only">
            {researching ? 'Looking through your sources for the next useful story.' : ''}
          </p>
          <div className="flex flex-col gap-4 @min-[36rem]:flex-row @min-[36rem]:items-center">
            <ul
              aria-label="Video ideas"
              className="m-0 grid w-full max-w-[24rem] shrink-0 list-none grid-cols-3 gap-2.5 p-0"
            >
              {ideas.map((it, i) => (
                <li key={it.id} data-idea={it.slug}>
                  {researching ? (
                    <span
                      aria-hidden
                      data-ghost
                      className="block aspect-[9/16] w-full rounded-2xl border-[1.5px] border-dashed border-rule-strong bg-sunken"
                    />
                  ) : (
                    <motion.button
                      type="button"
                      initial={round > 0 ? { opacity: 0, y: RISE } : false}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...FADE, delay: i * 0.08 }}
                      aria-pressed={i === chosen}
                      onClick={() => setChosen(i)}
                      onPointerEnter={() => setNear(i)}
                      onPointerLeave={() => setNear(null)}
                      onFocus={() => setNear(i)}
                      onBlur={() => setNear(null)}
                      className={cn(
                        'relative block aspect-[9/16] w-full overflow-hidden rounded-2xl bg-viewer text-start shadow-reel',
                        i === chosen && 'outline-[3px] outline-offset-3 outline-teal-strong outline-solid',
                      )}
                    >
                      <ClipLoop clipId={it.clipId} play={near === i} />
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-viewer/80 to-transparent"
                      />
                      <span className="absolute top-2 left-2 inline-flex max-w-[calc(100%-1rem)] rounded-pill bg-sticker-paper px-2 py-0.5 type-caption font-semibold text-sticker-paper-ink">
                        <span className="truncate">{featureName(it)}</span>
                      </span>
                      <span className="absolute inset-x-2.5 bottom-2.5 line-clamp-3 type-caption leading-snug font-bold text-viewer-ink">
                        {it.hook}
                      </span>
                    </motion.button>
                  )}
                </li>
              ))}
            </ul>
            <AnimatePresence mode="wait" initial={false}>
              {researching ? null : (
                <motion.figure
                  key={idea.id}
                  initial={{ opacity: 0, y: RISE }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={FADE}
                  className="m-0 flex min-w-0 flex-1 gap-2.5 rounded-lg border border-rule-subtle bg-raised p-3"
                >
                  <Quote
                    aria-hidden
                    strokeWidth={ICON_STROKE}
                    className="mt-1 size-4 shrink-0 text-violet-strong"
                  />
                  <span className="flex min-w-0 flex-col gap-1">
                    <figcaption className="flex items-center gap-1.5 type-meta text-ink-2">
                      <Globe aria-hidden className="size-3.5 shrink-0" />
                      Why this idea fits · {line.locator}
                    </figcaption>
                    <blockquote className="m-0 type-body text-pretty text-ink">{line.excerpt}</blockquote>
                  </span>
                </motion.figure>
              )}
            </AnimatePresence>
          </div>
        </ShowcasePlate>
      </AppWindow>
    </MotionConfig>
  );
}
