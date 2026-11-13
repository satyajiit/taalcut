// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { PageArrival } from '#components/contact/page-arrival';
import { GetButtons } from '#components/download/get-buttons';
import { InstallSteps } from '#components/download/install-steps';
import { Kaatu } from '#components/kaatu/kaatu';
import { PlatformJump } from '#components/platforms/platform-jump';
import { PlatformList } from '#components/platforms/platform-list';
import { JsonLd } from '#components/ui/json-ld';
import { page } from '#content/pages';
import { PLATFORMS_PAGE } from '#content/platforms';
import { breadcrumbJsonLd, softwareApplicationJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /download/ · Download · mode: Persuade · system: WEB2 Remix Vernacular · lane L4
 * The release's download and what stands around it. The head: the title, the lead, Download for Mac (the page's one
 * marigold fill) and GitHub, the version and what it needs, and its one known limit in words. Then the Mac as
 * Taalcut running on it, with its requirements as stickers on the window and in full beside it, and the way to the
 * release's notes and checksums. Then the three steps to install it and the facts beside a download (signed and
 * notarized, what to expect, the language, the release's page, the source, where to report). Last, the two platforms
 * without a download: Ubuntu's window, which runs from source, and Windows as an empty outlined window, after 1.0.
 * The visitor's own platform wears a sticker (the script reads it; the server HTML marks none). No band closes this
 * page: its head already holds the buttons.
 * states: the buttons', the blocks' and the facts' own. */

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
            <div className="flex flex-wrap items-end gap-x-10 gap-y-6">
              <GetButtons limit />
              <Kaatu pose="laptop" size={112} interactive sticker toward="left" className="-my-2" />
            </div>
            <PlatformJump />
          </PageArrival>
          <PlatformList ids={['macos']} />
        </div>
      </div>
      <InstallSteps />
      <div className="overflow-x-clip px-gutter pt-section-top pb-section-bottom">
        <div className="mx-auto max-w-site">
          <PlatformList ids={['ubuntu', 'windows']} />
        </div>
      </div>
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
