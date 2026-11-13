// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* art: /ai/ › the page head's art · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the reel frame's own (poster; playing when half on screen in a shown tab; paused by the visitor's Pause;
 *   reduced motion never starting by itself) · its violet slot strip fills stories-style on the reel's clock, the rose
 *   beat ticks swelling as it plays · the stickers rest on their tilts and lean toward a mouse or trackpad pointer ·
 *   without JavaScript (the poster, the strip and stickers at rest). Its only control is the reel's Pause/Play.
 * Whichever AI you bring, it cuts your reel: the owner's Vietnam reel as Taalcut cut it from the roll, in the world's
 * 9:16 frame (tilted a degree, so the strip reads straight) with the AI's violet slot strip on top, its part names
 * over it and no slot numbers at this width, and the three ways in hanging off its edges as stickers: your
 * ChatGPT plan, your API keys, or the models on your computer. The stickers are the page's words (AI_STICKERS), and
 * the lead under the h1 says them too. Not the home hero's stage: no app window, no Kaatu at the bezel. */

import { KeyRound, Laptop } from 'lucide-react';
import { type MotionValue, useMotionValue } from 'motion/react';
import { reelSegments, spanStyle } from '#components/demo/template-bar';
import { ReelFrame } from '#components/ui/reel-frame';
import { SegmentBar } from '#components/ui/segment-bar';
import { GROUP_WORDS, groupsOf } from '#components/ui/segments';
import { Sticker } from '#components/ui/sticker';
import { AI_HEAD } from '#content/ai-map';
import { AI_STICKERS } from '#content/providers';
import { reelById } from '#content/reels';
import type { Reel } from '#content/schema';
import { cn } from '#lib/cn';

/** A phone's stickers a size down, so they hang off a 12.5 rem reel without leaving a 320 px screen. */
const SMALL_ON_PHONE = 'max-sm:gap-1 max-sm:px-2.5 max-sm:py-1 max-sm:[font-size:0.8125rem] max-sm:[&_svg]:size-3.5';

/**
 * The AI's slot strip on a reel this narrow (under 30 rem): the part names in one row that gives each part room for
 * its whole word, as the template bar lays them out, each with its bracket, over the violet segments without their
 * numbers, which would collide at this width. It fills by the reel's clock, rose beat ticks under it.
 */
function HeadStrip({ reel, time }: { readonly reel: Reel; readonly time: MotionValue<number> }) {
  const segments = reelSegments(reel);
  const groups = groupsOf(segments);
  return (
    <div data-slot="head-strip" className="relative w-full">
      <div aria-hidden className="flex gap-1">
        {groups.map((g, i) => (
          <span
            key={`${g.group}-${g.from}`}
            className={cn(
              'min-w-max flex-1 basis-0 type-meta font-semibold whitespace-nowrap text-viewer-ink [text-shadow:0_1px_3px_var(--color-viewer)]',
              i === 0 ? 'text-start' : i === groups.length - 1 ? 'text-end' : 'text-center',
            )}
            style={{ flexGrow: g.to - g.from + 1 }}
          >
            {GROUP_WORDS[g.group]}
          </span>
        ))}
      </div>
      <div aria-hidden className="relative mt-0.5 h-1.5">
        {groups.map((g) => (
          <span key={`${g.group}-${g.from}`} className="absolute top-0 h-1.5 rounded-t-sm border-x border-t border-viewer-ink/80" style={spanStyle(g.from - 1, g.to - 1, segments.length)} />
        ))}
      </div>
      <SegmentBar segments={segments} beats={reel.beats} time={time} state="playing" tone="surface" className="mt-1 [&_[data-slot=segment]]:h-2.5" />
    </div>
  );
}

export function AiHeadArt() {
  const reel = reelById(AI_HEAD.reel);
  const time = useMotionValue(0);
  return (
    <div data-slot="ai-head-art" className="relative mx-auto flex w-full justify-center select-none sm:py-2 lg:py-6">
      <div className="relative w-[12.5rem] -rotate-1 sm:w-[14rem] lg:w-[17rem]">
        <ReelFrame
          sources={reel.made.length > 0 ? reel.made : reel.reference}
          poster={reel.poster}
          label={AI_HEAD.label(reel.title)}
          time={time}
          control="bottom-left"
          bar={<HeadStrip reel={reel} time={time} />}
          stickers={
            <div aria-hidden className="absolute inset-0">
              <div className="absolute top-[24%] -left-[46%] sm:-left-[52%]">
                <Sticker field="sky" brand="openai" tilt={-6} size="md" delay={0.05} className={SMALL_ON_PHONE}>
                  {AI_STICKERS.plan}
                </Sticker>
              </div>
              <div className="absolute top-[47%] -right-[40%] sm:-right-[46%]">
                <Sticker field="violet" icon={KeyRound} tilt={5} size="md" delay={0.15} className={SMALL_ON_PHONE}>
                  {AI_STICKERS.keys}
                </Sticker>
              </div>
              <div className="absolute top-[71%] -left-[40%] sm:-left-[48%]">
                <Sticker field="teal" icon={Laptop} tilt={-3} size="md" delay={0.25} className={SMALL_ON_PHONE}>
                  {AI_STICKERS.local}
                </Sticker>
              </div>
            </div>
          }
        />
      </div>
    </div>
  );
}
