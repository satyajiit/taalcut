// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: head art · mode: Persuade · system: WEB2 Remix Vernacular
 * states: resting · stickers lean toward a mouse or trackpad pointer · Kaatu acts its pose once on screen and follows
 *   a near pointer where its frame can turn (decoration: not a control, so no poke here; the footer's Kaatu takes
 *   pokes) · reduced motion (still) · without JavaScript (resting). Decorative: hidden from assistive technology,
 *   since every word on a sticker is also the page's.
 * The right-hand art of the FAQ, About and Press heads: Kaatu as the page's one sticker character, with the page's
 * facts on stickers around it. The stickers sit inside the art's box, so nothing hangs past the page at 320 px. */

import { AudioLines, BookOpen, Download, LayoutList, MessageCircleQuestion, Palette, Volume2 } from 'lucide-react';
import { Logo } from '#components/brand/logo';
import { Kaatu } from '#components/kaatu/kaatu';
import { Sticker } from '#components/ui/sticker';
import { ABOUT } from '#content/about';
import { FAQ, FAQ_GROUPS } from '#content/faq';
import { PRESS } from '#content/press';
import { ICONS } from '#lib/icons';

const BOX = 'relative mx-auto aspect-[5/4] w-full max-w-[30rem] select-none';

export function FaqArt() {
  return (
    <div aria-hidden className={BOX}>
      <span className="absolute inset-[10%] rounded-reel bg-sunken" />
      <span className="absolute inset-x-[22%] top-[22%] h-3 rounded-pill bg-rule" />
      <span className="absolute inset-x-[22%] top-[34%] h-3 w-[40%] rounded-pill bg-rule-subtle" />
      <Kaatu pose="search" size={120} follow sticker toward="left" className="absolute right-[12%] bottom-[8%]" />
      <div className="absolute top-[2%] left-[2%]">
        <Sticker field="pink" icon={MessageCircleQuestion} tilt={-6} size="lg">
          {FAQ.length} answers
        </Sticker>
      </div>
      <div className="absolute top-[46%] left-[4%]">
        <Sticker field="sky" icon={LayoutList} tilt={4}>
          {FAQ_GROUPS.length} topics
        </Sticker>
      </div>
      <div className="absolute top-[12%] right-[0%]">
        <Sticker field="lime" icon={BookOpen} tilt={5}>
          Straight answers
        </Sticker>
      </div>
    </div>
  );
}

export function AboutArt() {
  return (
    <div aria-hidden className={BOX}>
      <span className="absolute inset-[8%] rounded-full border-2 border-dashed border-rule" />
      <Logo kind="symbol" colourway="four-colour" className="absolute top-[14%] left-[30%] size-[40%] opacity-90" />
      <Kaatu pose="heart-hands" size={120} follow sticker className="absolute bottom-[4%] left-[8%] -rotate-3" />
      <div className="absolute top-[4%] right-[2%]">
        <Sticker field="marigold" icon={Volume2} tilt={6} size="lg">
          {ABOUT.stickers.say}
        </Sticker>
      </div>
      <div className="absolute top-[50%] right-[0%]">
        <Sticker field="pink" icon={AudioLines} tilt={-4}>
          {ABOUT.stickers.taal}
        </Sticker>
      </div>
      <div className="absolute right-[14%] bottom-[6%]">
        <Sticker field="teal" icon={ICONS.trim} tilt={3}>
          {ABOUT.stickers.cut}
        </Sticker>
      </div>
    </div>
  );
}

export function PressArt() {
  return (
    <div aria-hidden className={BOX}>
      {/* Each drawing on the ground it is made for, in both themes: white for the light one, the viewer for the dark. */}
      <span className="absolute top-[8%] left-[6%] grid h-[38%] w-[70%] place-items-center rounded-window bg-sticker-cut px-[8%] shadow-window">
        <img src="/brand/taalcut-horizontal-four-colour-light.svg" alt="" className="h-auto w-full" />
      </span>
      <span className="absolute top-[40%] right-[4%] grid h-[30%] w-[52%] place-items-center rounded-window bg-viewer px-[7%] shadow-window">
        <img src="/brand/taalcut-horizontal-two-colour-dark.svg" alt="" className="h-auto w-full" />
      </span>
      <Kaatu pose="selfie" size={112} follow sticker className="absolute bottom-[2%] left-[6%] -rotate-2" />
      <div className="absolute top-[0%] right-[2%]">
        <Sticker field="sky" icon={ICONS.template} tilt={6}>
          {PRESS.stickers.logos}
        </Sticker>
      </div>
      <div className="absolute right-[30%] bottom-[8%]">
        <Sticker field="pink" icon={Download} tilt={-5}>
          {PRESS.stickers.kaatu}
        </Sticker>
      </div>
      <div className="absolute right-[0%] bottom-[22%]">
        <Sticker field="lime" icon={Palette} tilt={4}>
          {PRESS.stickers.colours}
        </Sticker>
      </div>
    </div>
  );
}
