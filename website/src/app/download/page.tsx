// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { PageArrival } from '#components/contact/page-arrival';
import { Kaatu } from '#components/kaatu/kaatu';
import { PlatformJump } from '#components/platforms/platform-jump';
import { PlatformList } from '#components/platforms/platform-list';
import { JsonLd } from '#components/ui/json-ld';
import { WaitlistBand } from '#components/waitlist/waitlist-band';
import { page } from '#content/pages';
import { PLATFORMS_PAGE } from '#content/platforms';
import { breadcrumbJsonLd, softwareApplicationJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /download/ · Platforms · mode: Persuade · system: WEB2 Remix Vernacular · lane L4
 * Each platform is shown as Taalcut running on it: an Apple silicon Mac's window with its reel pasted as a link,
 * Ubuntu's with the reel dropped in as a file, and Windows as an empty outlined window, after 1.0. Requirements ride
 * the windows as stickers and are listed in full beside them. The visitor's platform comes first (the script reads
 * it; the server HTML lists the three in the default order). Nothing is released, so each joins the waitlist with
 * its platform chosen; no download button, no checksum (they come with the first public build, docs/release.md). The
 * band closes the page with the one marigold fill.
 * states: the blocks' and the band's own. */

const PATH = '/download/';
export const metadata = pageMetadata(PATH);

export default function Page() {
  const entry = page(PATH);
  return (
    <>
      <div className="overflow-x-clip px-gutter pt-10 pb-section-bottom sm:pt-14">
        <div className="mx-auto flex max-w-site flex-col gap-[clamp(5rem,7vw+2rem,9rem)]">
          <PageArrival className="relative flex flex-col gap-6">
            <h1 className="m-0 type-site-display text-ink">
              {PLATFORMS_PAGE.title.map((line, i) => (
                <span key={line} className="block">
                  {i > 0 ? ' ' : null}
                  {line}
                </span>
              ))}
            </h1>
            <p className="m-0 max-w-[34em] type-site-lead text-ink-2">{PLATFORMS_PAGE.lead}</p>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-6">
              <PlatformJump />
              <Kaatu pose="laptop" size={112} interactive sticker toward="left" className="-my-4" />
            </div>
          </PageArrival>
          <PlatformList />
        </div>
      </div>
      <WaitlistBand source="download" heading="Be first on your computer when the beta opens." />
      <JsonLd
        data={[
          softwareApplicationJsonLd(),
          breadcrumbJsonLd([
            { name: 'Home', path: '/' },
            { name: entry.title, path: PATH },
          ]),
        ]}
      />
    </>
  );
}
