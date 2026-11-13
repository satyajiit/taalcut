// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { Clock, Database, Mail, Trash2, type LucideIcon } from 'lucide-react';
import { InlineLink } from '#components/content/inline-text';
import { PageArrival } from '#components/contact/page-arrival';
import { GetButtons } from '#components/download/get-buttons';
import { Kaatu } from '#components/kaatu/kaatu';
import { JsonLd } from '#components/ui/json-ld';
import { SegmentBar } from '#components/ui/segment-bar';
import { Sticker } from '#components/ui/sticker';
import { page } from '#content/pages';
import type { SlotRole } from '#content/schema';
import { WAITLIST_PAGE } from '#content/waitlist';
import { ICON_SIZE, ICON_STROKE, ICONS } from '#lib/icons';
import { breadcrumbJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /waitlist/ · the waitlist, closed · mode: Persuade · system: WEB2 Remix Vernacular · lane L4
 * The waitlist took sign-ups until the first release. Its address stays for the links that point at it (the
 * Instagram link, `?ref=ig`; search results), and now says Taalcut is out: the h1, the stickers, that the list is
 * closed, Download for Mac (the page's one marigold fill) and GitHub. Beside them, for people who joined, what they
 * were promised and what is kept, as a reel-cornered card with a stories bar over it and Kaatu on its edge.
 * No form, and nothing here collects anything. Unlisted: off the sitemap, llms.txt and the .md mirrors.
 * states: the buttons' own; the card's link (default · hover · focus). The stickers pop in once. */

const PATH = '/waitlist/';
export const metadata = pageMetadata(PATH);

/** A glyph for each of the facts, in their order: what you get, what we keep, how long, leaving. */
const FACT_ICONS: readonly LucideIcon[] = [Mail, Database, Clock, Trash2];
const FACT_TONES: readonly string[] = [
  'bg-sticker-pink text-sticker-pink-ink',
  'bg-sticker-sky text-sticker-sky-ink',
  'bg-sticker-violet text-sticker-violet-ink',
  'bg-sticker-teal text-sticker-teal-ink',
];

/** The stories bar over the card: one equal part a fact, the motif only. */
const STORY: { start: number; end: number; group: SlotRole }[] = WAITLIST_PAGE.facts.map((_, i) => ({
  start: i,
  end: i + 1,
  group: (['hook', 'build', 'peak', 'outro'] as const)[i] ?? 'build',
}));

export default function Page() {
  const entry = page(PATH);
  const Next = ICONS.next;
  return (
    <>
      <div className="mx-auto grid max-w-site grid-cols-1 gap-x-16 gap-y-20 overflow-x-clip px-gutter pt-10 pb-section-bottom sm:pt-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <PageArrival className="flex min-w-0 flex-col gap-6">
          <h1 className="m-0 type-site-display text-balance text-ink">{entry.title}.</h1>
          <div aria-hidden className="-mt-1 flex flex-wrap items-center gap-2">
            <Sticker field="paper" icon="approve" tilt={-4}>
              {WAITLIST_PAGE.stickers.closed}
            </Sticker>
            <Sticker field="lime" icon="gift" tilt={3} delay={0.06}>
              {WAITLIST_PAGE.stickers.free}
            </Sticker>
            <Sticker field="sky" brand="apple" tilt={-2} delay={0.12}>
              {WAITLIST_PAGE.stickers.mac}
            </Sticker>
          </div>
          <div className="flex max-w-[34em] flex-col gap-3">
            <p className="m-0 type-site-lead text-ink">{entry.description}</p>
            <p className="m-0 type-site-body text-ink-2">{WAITLIST_PAGE.lead}</p>
          </div>
          <GetButtons limit className="mt-2" />
        </PageArrival>

        <PageArrival delay={0.1} className="self-start lg:mt-28">
          <aside
            aria-labelledby="waitlist-joined"
            className="relative rounded-reel bg-panel px-5 pt-14 pb-8 sm:px-8"
          >
            <Kaatu
              mood="wave"
              size={112}
              toward="left"
              interactive
              sticker
              className="absolute -top-16 end-6"
            />
            <SegmentBar segments={STORY} state="filled" tone="surface" decorative className="mb-6" />
            <h2 id="waitlist-joined" className="m-0 type-site-subhead text-ink">
              {WAITLIST_PAGE.joinedHeading}
            </h2>
            <dl className="m-0 mt-6 flex flex-col gap-5">
              {WAITLIST_PAGE.facts.map(([label, value], i) => {
                const Icon = FACT_ICONS[i] ?? Mail;
                return (
                  <div key={label} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 gap-y-0.5">
                    <dt className="contents">
                      <span
                        aria-hidden
                        className={`row-span-2 inline-grid size-10 place-items-center rounded-2xl shadow-sticker ${FACT_TONES[i] ?? FACT_TONES[0]} ${i % 2 ? 'rotate-3' : '-rotate-3'}`}
                      >
                        <Icon strokeWidth={ICON_STROKE} className="size-5" />
                      </span>
                      <span className="self-end type-label font-semibold text-ink">{label}</span>
                    </dt>
                    <dd className="col-start-2 m-0 type-site-body text-ink-2 [overflow-wrap:anywhere]">
                      {value}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <InlineLink
              href="/privacy/#waitlist"
              className="mt-8 inline-flex items-center gap-1.5 type-label font-semibold"
            >
              {WAITLIST_PAGE.privacy}
              <Next size={ICON_SIZE.md} strokeWidth={ICON_STROKE} aria-hidden />
            </InlineLink>
          </aside>
        </PageArrival>
      </div>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: entry.title, path: PATH },
        ])}
      />
    </>
  );
}
