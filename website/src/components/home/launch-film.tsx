// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the launch film · mode: Persuade · system: WEB2 Remix Vernacular
 * states: arrived (server HTML, reduced motion) · arriving (heading, lead, then the frame rise with the section) ·
 *   poster: default (composed cover artwork, a paper play sticker on it) · hover (the sticker lifts, the frame brightens) ·
 *   focus (the focus ring, inset so the frame's rounding doesn't clip it) · active (gives 3 %) · playing (YouTube's player in the frame's place, autoplaying) ·
 *   reduced motion (no lift)
 * The film plays from YouTube's privacy-enhanced host. Nothing loads from YouTube until the press: the poster and the
 * page are the site's own (privacy › The launch film). Under the frame: that sentence and a plain link to YouTube. */

import { Play } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { ARRIVE_ITEM, Section } from '#components/ui/section';
import { FILM_SECTION as F } from '#content/home';
import { cn } from '#lib/cn';

export const FILM_EMBED = `https://www.youtube-nocookie.com/embed/${F.youtubeId}?autoplay=1&rel=0&playsinline=1`;
export const FILM_WATCH = `https://www.youtube.com/watch?v=${F.youtubeId}`;

export function LaunchFilm() {
  const [playing, setPlaying] = useState(false);
  return (
    <Section id={F.id} heading={F.heading} lead={F.lead} bodyClassName="mt-10">
      <motion.figure variants={ARRIVE_ITEM} className="m-0">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-sunken shadow-md ring-1 ring-rule-subtle">
          {playing ? (
            <iframe
              src={FILM_EMBED}
              title={F.frameTitle}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="absolute inset-0 size-full border-0"
            />
          ) : (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              aria-label={`${F.play}, ${F.length}`}
              className="group absolute inset-0 block size-full cursor-pointer focus-visible:outline-3 focus-visible:outline-focus focus-visible:[outline-offset:-6px]"
            >
              <img
                src={F.poster.large}
                srcSet={`${F.poster.small} 960w, ${F.poster.large} 1920w`}
                sizes="(min-width: 1280px) 1200px, 100vw"
                width={1920}
                height={1080}
                alt=""
                loading="lazy"
                decoding="async"
                className="size-full object-cover brightness-90 transition-[filter] duration-(--dur-short) group-hover:brightness-100"
              />
              <span
                aria-hidden
                className={cn(
                  // The compact corner sticker keeps the cover's title clear on phones and tablets.
                  'absolute right-3 bottom-3 inline-flex h-10 -rotate-2 items-center gap-2 rounded-pill bg-sticker-paper px-4 whitespace-nowrap text-sticker-paper-ink shadow-sticker select-none type-sticker max-xl:[font-size:0.9375rem]',
                  'xl:right-auto xl:bottom-[8%] xl:left-1/2 xl:h-14 xl:-translate-x-1/2 xl:gap-3 xl:px-6',
                  'transition-[rotate,translate,scale] duration-(--dur-short) ease-(--ease-out)',
                  'group-hover:-translate-y-0.5 group-hover:rotate-0 group-active:scale-[0.97] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0',
                )}
              >
                <Play aria-hidden className="size-4 fill-current xl:size-5" strokeWidth={2.5} />
                <span className="xl:hidden">{F.playShort}</span>
                <span className="max-xl:hidden">{F.play}</span>
                <span className="opacity-70">{F.length}</span>
              </span>
            </button>
          )}
        </div>
        <figcaption className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 type-label text-ink-2">
          <span>{F.note}</span>
          <a href={FILM_WATCH} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
            {F.watch}
          </a>
        </figcaption>
      </motion.figure>
    </Section>
  );
}
