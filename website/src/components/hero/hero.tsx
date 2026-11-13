// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: home hero (the first viewport) · mode: Persuade · system: WEB2 Remix Vernacular
 * From 1280 px, two tracks as the direction contract's FIRST VIEWPORT draws them: the words, exactly as wide as the
 * h1's longest line (the h1 in three lines, "Every reel you / save becomes / one you can make.", one line under it,
 * Download for Mac with the screen's one marigold fill and GitHub beside it, the platform row), then, 48 px on, the
 * stage: the saved reel playing full height and the coded app window filling its slots. Below 1280 the words sit over
 * the stage (in two columns from 1024); on a phone it is one column, the buttons above the reel, the reel high enough that its
 * strip and footage start in the first screen, and the platform row under the reel. The hero ends close under the
 * stage and sets the next section's top padding from 1280 (the `[&+section]` rule), so that section's heading and its
 * window's title bar start in the first viewport. Marked data-hero, so the nav deepens once it's past.
 * states: the buttons' (download/get-buttons.tsx) and the link to /download/ under them (default · hover · focus) ·
 *   the stage's (stage.tsx) · platform row: static words, each OS by its own name beside its SVGL icon · without
 *   JavaScript (every word, both buttons, the reel's poster, the window waiting)
 * motion: none here: the h1 is the page's largest paint and never waits. The stage holds the page's one arrival. */

import { InlineLink } from '#components/content/inline-text';
import { GetButtons } from '#components/download/get-buttons';
import { IconText } from '#components/ui/icon-text';
import { ProductHuntBadge } from '#components/ui/product-hunt-badge';
import { GET } from '#content/release';
import { NAV_GET } from '#content/site';
import { cn } from '#lib/cn';
import { HERO_MARK } from '#lib/hero';
import { HERO } from './copy';
import { Stage } from './stage';

function PlatformRow({ className }: { readonly className?: string }) {
  return (
    <ul aria-label={HERO.platforms} data-slot="hero-platforms" className={cn('flex flex-wrap items-center gap-x-5 gap-y-2 type-label text-ink', className)}>
      {HERO.platformRow.map((p) => (
        <IconText key={p.brand} as="li" brand={p.brand} className="whitespace-nowrap">
          {p.name} <span className="text-ink-3">{p.note}</span>
        </IconText>
      ))}
    </ul>
  );
}

export function Hero() {
  const [lead, leadWide, leadEnd] = HERO.lead;
  const last = HERO.titleLines.length - 1;
  return (
    // The page's hero mark (#lib/hero): the nav deepens its tint once this has gone up under it.
    <section {...HERO_MARK} aria-labelledby="home-title" className="overflow-x-clip xl:[&+section]:pt-14">
      <div className="mx-auto grid max-w-[90rem] grid-cols-1 items-center gap-x-12 gap-y-8 px-gutter pt-6 pb-12 sm:pt-12 xl:grid-cols-[max-content_minmax(0,1fr)] xl:pt-6 xl:pb-4">
        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start lg:gap-x-12 xl:flex xl:flex-col xl:items-stretch xl:gap-7">
          <h1 id="home-title" className="type-site-display text-balance text-ink lg:col-span-6">
            {/* One line each from 1280 px; below that the words wrap as the column allows. */}
            {HERO.titleLines.map((line, i) => (
              <span key={line} className="xl:block">
                {line}
                {i < last ? ' ' : null}
              </span>
            ))}
          </h1>
          <div className="flex min-w-0 flex-col gap-5 lg:col-span-6 xl:gap-7">
            <p className="max-w-[30rem] type-site-lead text-ink-2">
              {lead}
              <span className="max-sm:hidden">{leadWide}</span>
              {leadEnd}
            </p>
            <GetButtons>
              <InlineLink href={NAV_GET.href} className="self-start type-body font-semibold">
                {GET.more}
              </InlineLink>
            </GetButtons>
            <PlatformRow className="max-sm:hidden" />
            <ProductHuntBadge className="max-sm:hidden" />
          </div>
        </div>
        {/* On a phone the platform row moves under the reel, so the reel starts higher. */}
        <Stage under={<PlatformRow />} />
      </div>
    </section>
  );
}
