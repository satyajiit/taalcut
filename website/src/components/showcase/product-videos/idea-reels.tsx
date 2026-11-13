// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a product's video ideas, as reels · mode: Operate · system: WEB2 Remix Vernacular (violet is the AI's
 *   research: the quote glyph; teal is yours: the idea you made into your video)
 * Products › Taalcut › Ideas (product-content.tsx), told in reels: What’s worth showing next? and Find video ideas,
 *   then a row of 9:16 idea reels from the owner's footage, each about one of Taalcut's features (its name on the
 *   reel, its hook over the footage) with the line from taalcut.app behind it as a tilted quote sticker (word for
 *   word, with where it was found). Choosing a reel makes it your video. Under the row, Why this idea fits: the
 *   angle and the feature page's own line, quoted. While research runs Kaatu looks through the sources and each
 *   reel's place waits as a dashed frame, so nothing below moves.
 * states: researching (Find video ideas busy, Kaatu, the dashed frames) · ideas (arriving in turn) · a reel: default
 *   · hover and focus (its loop plays) · active (a 2 % give) · chosen (a teal ring, Your video, aria-pressed) ·
 *   creating (the chosen reel says so) · Find video ideas: default, hover, focus, active, busy
 * motion: a reel rises 8 px and fades in, in turn; the stickers sit at their tilt; reduced motion: the 150 ms fade,
 *   nothing rises, the loops wait */

import { Globe, Hourglass, Quote, ScanSearch, Tag } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Kaatu } from '#components/kaatu/kaatu';
import { buttonClasses } from '#components/ui/button-classes';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { DUR, EASE_OUT, RISE } from '#lib/motion';
import { Chip } from '../chip';
import { ClipLoop } from './clip-reel';
import { featureName, type Idea } from './ideas';

const RISE_IN = { duration: DUR.short, ease: EASE_OUT } as const;
const TILTS = ['-rotate-3', 'rotate-2', '-rotate-2'] as const;
/** A reel card's width: three abreast in a wide window, a row to swipe in a narrow one. */
const CARD = 'w-[9.5rem] shrink-0 snap-start @min-[40rem]:w-auto';

/** The line from taalcut.app behind an idea, as a die-cut quote sticker hanging off its reel. */
function QuoteSticker({ idea, tilt }: { readonly idea: Idea; readonly tilt: string }) {
  const source = idea.evidence.find((e) => e.excerpt.includes(idea.quote)) ?? idea.evidence[0]!;
  return (
    <figure
      data-evidence
      data-quote
      className={cn(
        'relative z-10 m-0 -mt-7 mx-1.5 flex flex-col gap-1 rounded-xl bg-sticker-paper px-2.5 py-2 text-sticker-paper-ink shadow-sticker ring-2 ring-sticker-cut',
        tilt,
      )}
    >
      <blockquote className="m-0 flex gap-1.5 type-caption leading-snug font-semibold text-pretty">
        <Quote aria-hidden strokeWidth={ICON_STROKE} className="mt-0.5 size-3 shrink-0 text-violet-strong" />
        <q>{idea.quote}</q>
      </blockquote>
      <figcaption className="flex min-w-0 gap-1 type-caption text-ink-2">
        <Globe aria-hidden className="size-3 shrink-0 self-start mt-0.5" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{source.locator}</span>
      </figcaption>
    </figure>
  );
}

function IdeaReel({
  idea,
  index,
  chosen,
  making,
  onChoose,
}: {
  readonly idea: Idea;
  readonly index: number;
  readonly chosen: boolean;
  readonly making: boolean;
  readonly onChoose: () => void;
}) {
  const [near, setNear] = useState(false);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-pressed={chosen}
        onClick={onChoose}
        onPointerEnter={() => setNear(true)}
        onPointerLeave={() => setNear(false)}
        onFocus={() => setNear(true)}
        onBlur={() => setNear(false)}
        className={cn(
          'group relative block aspect-[9/16] w-full overflow-hidden rounded-reel bg-viewer text-start shadow-reel',
          'transition-transform duration-(--dur-micro) ease-(--ease-out) active:scale-[0.98] motion-reduce:active:scale-100',
          chosen && 'outline-[3px] outline-offset-3 outline-teal-strong outline-solid',
        )}
      >
        <ClipLoop clipId={idea.clipId} play={near && !chosen} />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-linear-to-b from-viewer/60 to-transparent" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-viewer/80 to-transparent" />
        <span className="absolute inset-x-2.5 top-2.5 flex flex-wrap items-center gap-1">
          <span className="inline-flex max-w-full items-center gap-1 rounded-pill bg-sticker-paper px-2 py-0.5 type-caption font-semibold text-sticker-paper-ink">
            <Tag aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{featureName(idea)}</span>
          </span>
          {chosen ? (
            <Chip tone="you">{making ? <Hourglass aria-hidden /> : null}{making ? 'Creating' : 'Your video'}</Chip>
          ) : null}
        </span>
        <span className="absolute inset-x-3 bottom-9 type-label leading-tight font-bold text-balance text-viewer-ink">{idea.hook}</span>
      </button>
      <QuoteSticker idea={idea} tilt={TILTS[index % TILTS.length]!} />
    </div>
  );
}

/** A reel's place while research runs: the dashed frame, so nothing below moves. */
function Waiting() {
  return (
    <span aria-hidden data-ghost className="flex aspect-[9/16] w-full flex-col justify-end gap-2 rounded-reel border-[1.5px] border-dashed border-rule-strong bg-sunken p-4">
      {['w-3/4', 'w-1/2'].map((w) => (
        <span key={w} className={cn('block h-2.5 rounded-pill bg-rule', w)} />
      ))}
    </span>
  );
}

/** Why this idea fits: the angle, and the feature page's own line, quoted with where it was found. */
export function WhyItFits({ idea }: { readonly idea: Idea }) {
  const line = idea.evidence[0]!;
  return (
    <section data-why aria-label="Why this idea fits" className="flex flex-col gap-2.5 rounded-xl bg-well p-4">
      <h4 className="m-0 type-label text-ink">Why this idea fits</h4>
      <p className="m-0 max-w-prose type-body text-pretty text-ink-2">{idea.angle}</p>
      <figure data-evidence className="m-0 flex gap-2.5">
        <Quote aria-hidden strokeWidth={ICON_STROKE} className="mt-1 size-4 shrink-0 text-violet-strong" />
        <span className="flex min-w-0 flex-col gap-1">
          <blockquote className="m-0 max-w-prose type-body text-pretty text-ink">{line.excerpt}</blockquote>
          <figcaption className="flex items-center gap-1.5 type-meta text-ink-2">
            <Globe aria-hidden className="size-3.5 shrink-0" />
            {line.locator}
          </figcaption>
        </span>
      </figure>
    </section>
  );
}

export function IdeaReels({
  ideas,
  arrived,
  researching,
  chosen,
  making,
  onChoose,
  onFind,
}: {
  readonly ideas: readonly Idea[];
  /** How many ideas have arrived (the arrival adds them in turn). */
  readonly arrived: number;
  readonly researching: boolean;
  /** The idea made into your video. */
  readonly chosen: string;
  /** Your video is being made. */
  readonly making: boolean;
  readonly onChoose: (idea: Idea) => void;
  readonly onFind: () => void;
}) {
  const shown = ideas.find((i) => i.id === chosen);
  return (
    <section aria-label="Video ideas" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="m-0 type-section text-ink">What’s worth showing next?</h3>
          <p className="m-0 max-w-prose type-meta text-pretty text-ink-2">One feature an idea, each backed by a line from your sources. Choose one to make it your video.</p>
        </div>
        <button type="button" className={buttonClasses('secondary', 'md')} aria-busy={researching || undefined} disabled={researching} onClick={onFind}>
          <ScanSearch aria-hidden className={cn('size-4', researching && 'animate-pulse motion-reduce:animate-none')} />
          Find video ideas
        </button>
      </div>
      <p role="status" className="m-0 flex min-h-6 items-center gap-3 type-body text-ink-2">
        {researching ? (
          <>
            <Kaatu pose="search" size={44} className="-my-3 shrink-0" />
            Looking through your sources for the next useful story.
          </>
        ) : arrived > 0 && ideas.length > 0 ? (
          'New video ideas are ready'
        ) : null}
      </p>
      <ul
        aria-label="Video ideas, as reels"
        className="m-0 -mx-1 flex list-none snap-x snap-mandatory gap-4 overflow-x-auto px-1 pt-1 pb-3 @min-[40rem]:mx-0 @min-[40rem]:grid @min-[40rem]:grid-cols-3 @min-[40rem]:overflow-visible @min-[40rem]:px-0"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {ideas.map((idea, i) =>
            researching || i >= arrived ? (
              <motion.li key={`waiting-${idea.id}`} className={CARD} transition={RISE_IN}>
                <Waiting />
              </motion.li>
            ) : (
              <motion.li
                key={idea.id}
                data-idea={idea.slug}
                data-chosen={idea.id === chosen || undefined}
                className={CARD}
                initial={{ opacity: 0, y: RISE }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: DUR.short } }}
                transition={{ ...RISE_IN, delay: i * 0.06 }}
              >
                <IdeaReel idea={idea} index={i} chosen={idea.id === chosen} making={making && idea.id === chosen} onChoose={() => onChoose(idea)} />
              </motion.li>
            ),
          )}
        </AnimatePresence>
      </ul>
      {shown && !researching && arrived > 0 ? <WhyItFits idea={shown} /> : null}
    </section>
  );
}
