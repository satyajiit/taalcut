// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { ArrowRight, House, LayoutGrid } from 'lucide-react';
import { NAV_GET } from '#content/site';
import type { Metadata } from 'next';
import { LostReel } from '#components/content/lost-reel';
import { ButtonLink } from '#components/ui/button';
import { ICON_STROKE } from '#lib/icons';

/* page: 404 · mode: Recover · system: WEB2 Remix Vernacular · lane L6
 * "House full" in this world: the display line and its fix beside the saved reel, its segment bar broken where this
 * page should be, the piece on the floor, and Kaatu searching behind the frame. Three ways on: home, the features and
 * the download. All secondary: a lost page offers ways back, so no marigold fill here.
 * states: links default · hover · focus (base ring) · active (2 % give); the reel's own (lost-reel.tsx) */

// No `robots` here: Next writes `<meta name="robots" content="noindex">` for a not-found page itself, and a second
// robots meta would contradict or repeat it (test/e2e/geo.spec.ts checks the 404 has exactly one).
export const metadata: Metadata = {
  title: 'Page not found',
};

export default function NotFound() {
  return (
    <section aria-labelledby="not-found-title" className="grid min-h-[calc(100svh-var(--spacing-nav))] items-center overflow-x-clip px-gutter pt-[min(12vh,6rem)] pb-section-bottom">
      <div className="mx-auto grid max-w-site items-center gap-x-16 gap-y-20 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex flex-col items-start gap-6">
          <h1 id="not-found-title" className="max-w-[12ch] type-site-display text-balance text-ink">
            This page isn’t on the beat.
          </h1>
          <p className="m-0 max-w-[30em] type-site-lead text-pretty text-ink-2">The address may have changed. These three have everything.</p>
          <nav aria-label="Ways on" className="mt-2 flex flex-wrap gap-3">
            <ButtonLink href="/" variant="secondary" size="lg">
              <House aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
              Go to the home page
            </ButtonLink>
            <ButtonLink href="/features/" variant="secondary" size="lg">
              <LayoutGrid aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
              See what it does
            </ButtonLink>
            <ButtonLink href={NAV_GET.href} variant="secondary" size="lg">
              {NAV_GET.label}
              <ArrowRight aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
            </ButtonLink>
          </nav>
        </div>
        <LostReel />
      </div>
    </section>
  );
}
