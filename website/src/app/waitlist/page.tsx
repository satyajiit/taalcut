// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { Clock, Database, Gift, Mail, Trash2, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { PageArrival } from '#components/contact/page-arrival';
import { SegmentBar } from '#components/ui/segment-bar';
import { JsonLd } from '#components/ui/json-ld';
import { WaitlistKaatu, WaitlistMoodProvider } from '#components/waitlist/kaatu-mood';
import { OfferStickers } from '#components/waitlist/offer-stickers';
import { WaitlistForm } from '#components/waitlist/waitlist-form';
import { page } from '#content/pages';
import type { SlotRole } from '#content/schema';
import { SITE } from '#content/site';
import { WAITLIST_PAGE } from '#content/waitlist';
import { ICON_SIZE, ICON_STROKE, ICONS } from '#lib/icons';
import { breadcrumbJsonLd } from '#lib/jsonld';
import { pageMetadata } from '#lib/seo';

/* page: /waitlist/ · mode: Persuade · system: WEB2 Remix Vernacular · lane L4
 * The form on its own page and the Instagram link's target (`?ref=ig`), so it reads phone first: the h1, the offer's
 * stickers, what Taalcut is, the form with every field; then what happens next, as a reel-cornered card with a
 * stories bar over it (one part a fact) and Kaatu standing on its edge, reacting to the form.
 * Wide: the form at the left, the card at the right. `?ref=` and `?platform=` work as before (the form reads them).
 * states: the form's own; Kaatu follows them. The stickers pop in once and lean toward a fine pointer. */

const PATH = '/waitlist/';
export const metadata = pageMetadata(PATH);

/** A glyph for each of the facts, in their order: what you get, what we keep, how long, leaving, the price. */
const FACT_ICONS: readonly LucideIcon[] = [Mail, Database, Clock, Trash2, Gift];
const FACT_TONES: readonly string[] = [
  'bg-sticker-pink text-sticker-pink-ink',
  'bg-sticker-sky text-sticker-sky-ink',
  'bg-sticker-violet text-sticker-violet-ink',
  'bg-sticker-teal text-sticker-teal-ink',
  'bg-sticker-lime text-sticker-lime-ink',
];

/** The stories bar over the card: one equal part a fact, the motif only. */
const STORY: { start: number; end: number; group: SlotRole }[] = WAITLIST_PAGE.facts.map((_, i) => ({
  start: i,
  end: i + 1,
  group: (['hook', 'build', 'build', 'peak', 'outro'] as const)[i] ?? 'build',
}));

export default function Page() {
  const entry = page(PATH);
  const Next = ICONS.next;
  return (
    <WaitlistMoodProvider>
      <div className="mx-auto grid max-w-site grid-cols-1 gap-x-16 gap-y-20 overflow-x-clip px-gutter pt-10 pb-section-bottom sm:pt-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <PageArrival className="flex min-w-0 flex-col gap-6">
          <h1 className="m-0 type-site-display text-balance text-ink">{entry.title}</h1>
          <OfferStickers className="-mt-1" />
          <div className="flex max-w-[34em] flex-col gap-3">
            <p className="m-0 type-site-lead text-ink">{entry.description}</p>
            <p className="m-0 type-site-body text-ink-2">{SITE.description}</p>
          </div>
          <WaitlistForm variant="page" source="waitlist-page" className="mt-2" />
        </PageArrival>

        <PageArrival delay={0.1} className="self-start lg:mt-28">
          <aside
            aria-labelledby="waitlist-next"
            className="relative rounded-reel bg-panel px-5 pt-14 pb-8 sm:px-8"
          >
            <WaitlistKaatu size={112} toward="left" className="absolute -top-16 end-6" />
            <SegmentBar segments={STORY} state="filled" tone="surface" decorative className="mb-6" />
            <h2 id="waitlist-next" className="m-0 type-site-subhead text-ink">
              {WAITLIST_PAGE.nextHeading}
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
                    <dd className="col-start-2 m-0 type-site-body text-ink-2">{value}</dd>
                  </div>
                );
              })}
            </dl>
            <Link
              href="/features/"
              className="mt-8 inline-flex items-center gap-1.5 rounded-sm type-label font-semibold text-ink underline decoration-rule-strong decoration-1 underline-offset-4 transition-colors duration-(--dur-micro) hover:decoration-ink"
            >
              See what Taalcut does
              <Next size={ICON_SIZE.md} strokeWidth={ICON_STROKE} aria-hidden />
            </Link>
          </aside>
        </PageArrival>
      </div>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: 'Home', path: '/' },
          { name: entry.title, path: PATH },
        ])}
      />
    </WaitlistMoodProvider>
  );
}
