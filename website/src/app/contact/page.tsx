// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { ContactThread } from '#components/contact/contact-thread';
import { ContactWays } from '#components/contact/contact-ways';
import { PageArrival } from '#components/contact/page-arrival';
import { JsonLd } from '#components/ui/json-ld';
import { WaitlistBand } from '#components/waitlist/waitlist-band';
import { CONTACT_PAGE } from '#content/contact';
import { page } from '#content/pages';
import { breadcrumbJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /contact/ · mode: Persuade · system: WEB2 Remix Vernacular · lane L4
 * A direct-message thread with Taalcut is the page: the h1 and its line at the left, the thread at the right (on a
 * phone, under them), and the other ways (the mailboxes with Copy, Instagram) right under the h1. The thread grows
 * with the page and the page scrolls; the left column keeps its own height, so no gap opens above the ways. The
 * waitlist band closes the page with its one marigold fill; Send is ink.
 * Wide: 'intro thread' / 'ways thread'. Narrow: intro, thread, ways, in the DOM's order, which is also the tab order.
 * states: the thread's and the band's own. */

const PATH = '/contact/';
export const metadata = pageMetadata(PATH);

const AREAS =
  "grid-cols-1 [grid-template-areas:'intro'_'thread'_'ways'] " +
  "lg:grid-cols-[minmax(0,1fr)_minmax(0,36rem)] lg:grid-rows-[auto_1fr] lg:[grid-template-areas:'intro_thread'_'ways_thread']";

export default function Page() {
  const entry = page(PATH);
  return (
    <>
      <div
        className={`mx-auto grid max-w-site gap-x-16 gap-y-12 px-gutter pt-10 pb-section-bottom sm:pt-14 lg:pt-8 ${AREAS}`}
      >
        <PageArrival className="flex flex-col gap-5 [grid-area:intro] lg:pt-6">
          <h1 className="m-0 type-site-display text-ink">
            {CONTACT_PAGE.title.map((line, i) => (
              <span key={line} className="block">
                {i > 0 ? ' ' : null}
                {line}
              </span>
            ))}
          </h1>
          <p className="m-0 max-w-[30em] type-site-lead text-ink-2">{CONTACT_PAGE.lead}</p>
        </PageArrival>
        <ContactThread className="[grid-area:thread]" />
        <PageArrival delay={0.12} className="[grid-area:ways] lg:self-start">
          <ContactWays headingId="contact-ways" />
        </PageArrival>
      </div>
      <WaitlistBand source="contact" />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: entry.title, path: PATH },
        ])}
      />
    </>
  );
}
