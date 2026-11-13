// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: more ways · A video per feature, drawn · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the run (more-kit): finished (Taalcut saved as a product with its sources, three video ideas each about one
 *   feature and quoting the line behind it, the research schedule, and the strongest idea made into a portrait video
 *   whose post waits for your approval) · playing (Find video ideas pops, the ideas rise one by one, then the video
 *   and its approval, about 3 s) · narrow tray (under 30 rem the video folds under the ideas' column and the sources
 *   leave the caption row). Decorative (aria-hidden).
 * Products as the app has it, for Taalcut itself: each idea names one of its features, and its quote is that
 *   feature's own line on this site (#content/features), so every line it cites is real. */

import { CalendarClock, Check, Globe, Lightbulb } from 'lucide-react';
import { motion } from 'motion/react';
import { AiMark } from '#components/brand/ai-mark';
import { LookGlyph } from '#components/showcase/icon-chip';
import { JOB_TEXT, lookOf } from '#components/showcase/look';
import { feature } from '#content/features';
import { MORE_WAYS } from '#content/home';
import { ICON_STROKE } from '#lib/icons';
import { Thumb } from './kit';
import { Tray } from './more-kit';
import { clipSprite } from './reel-data';
import { pop, rise } from './tour-motion';

const W = MORE_WAYS.rows['product-videos'];
const IDEA = (i: number) => 0.6 + i * 0.35;
const VIDEO = IDEA(3) + 0.1;

/** A summary's sentences, split after each full stop that ends one. */
export function sentences(text: string): string[] {
  return text.split(/(?<=\.)\s+/).filter(Boolean);
}

/** An idea: one feature and the line from the site behind it. */
export function ideaOf(slug: string, sentence: number): { readonly slug: string; readonly name: string; readonly quote: string } {
  const f = feature(slug);
  return { slug, name: f.name, quote: sentences(f.summary)[sentence] ?? f.summary };
}

export function ProductDrawing({ className }: { readonly className?: string }) {
  const ideas = W.ideas.map((i) => ideaOf(i.slug, i.sentence));
  return (
    <Tray
      place={W.place}
      icon={<Lightbulb strokeWidth={ICON_STROKE} />}
      end={
        <>
          <Globe strokeWidth={ICON_STROKE} className="size-3.5" />
          {W.sources[0]}
          <span className="text-ink-3">·</span>
          {W.sources[1]}
        </>
      }
      className={className}
      bodyClassName="grid grid-cols-1 gap-4 p-4 @[30rem]:grid-cols-[minmax(0,1fr)_auto] @[30rem]:p-5"
    >
      <div className="flex min-w-0 flex-col gap-2.5">
        <motion.span variants={pop(0.25)} className="inline-flex items-center gap-1.5 self-start rounded-pill bg-violet-soft px-2.5 py-1 type-caption font-semibold text-violet-strong">
          <AiMark className="size-3.5" />
          {W.find}
        </motion.span>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {ideas.map((idea, i) => {
            const look = lookOf(idea.slug);
            return (
              <motion.li key={idea.slug} variants={rise(IDEA(i))} className="flex min-w-0 items-start gap-2.5 rounded-xl bg-raised px-3 py-2 shadow-sm ring-1 ring-rule-subtle">
                <LookGlyph icon={look.icon} className={`mt-0.5 size-4 shrink-0 ${JOB_TEXT[look.job]}`} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate type-caption font-semibold text-ink">{idea.name}</span>
                  <span className="line-clamp-1 type-caption text-ink-2">“{idea.quote}”</span>
                </span>
              </motion.li>
            );
          })}
        </ul>
        <span className="inline-flex items-center gap-1.5 type-caption text-ink-2">
          <CalendarClock strokeWidth={ICON_STROKE} className="size-3.5" />
          {W.schedule}
        </span>
      </div>
      <motion.div variants={rise(VIDEO)} className="hidden flex-col items-center gap-2 @[30rem]:flex">
        <Thumb sprite={clipSprite('repeat-11')} className="aspect-[9/16] w-28 rounded-xl shadow-reel" />
        <motion.span
          variants={pop(VIDEO + 0.4)}
          className="inline-flex w-28 items-start justify-center gap-1 rounded-xl bg-teal-soft px-2 py-1 text-center type-caption font-semibold text-teal-strong"
        >
          <Check strokeWidth={ICON_STROKE + 0.5} className="mt-0.5 size-3 shrink-0" />
          {W.approval}
        </motion.span>
      </motion.div>
    </Tray>
  );
}
