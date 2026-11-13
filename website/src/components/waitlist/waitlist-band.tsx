// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: waitlist band · the close of every page: a reel-cornered panel with the line, the form and Kaatu
 * mode: Persuade · system: WEB2 Remix Vernacular (the 28 px reel corner, stickers on its edge carrying the offer's
 *   facts, Kaatu as a sticker standing on the panel's top edge; the form's button is the screen's one marigold fill)
 * states: the form's own; Kaatu follows them (waves at rest, glances while the field has focus, thinks while sending,
 *   delighted on the list, oops on a problem, asleep while the list is closed), and answers a click. The stickers pop
 *   in when the band arrives and lean toward a fine pointer; the words and the form rise in turn (ArriveGroup, unmarked:
 *   the band closes other pages, whose tests count their own [data-arrival] blocks); under reduced motion all rest.
 * A server component: the stickers' icons go by name.
 * The stickers say what the line and the form's consent line also say in words: one email, free, the platforms. */

import { Arrive, ArriveGroup } from '#components/ui/section';
import { Sticker } from '#components/ui/sticker';
import { WAITLIST_BAND } from '#content/waitlist';
import { WaitlistKaatu, WaitlistMoodProvider } from './kaatu-mood';
import { WaitlistForm } from './waitlist-form';

export function WaitlistBand({
  source,
  heading = WAITLIST_BAND.heading,
}: {
  readonly source: string;
  readonly heading?: string;
}) {
  return (
    <section aria-labelledby={`band-${source}`} className="px-gutter pt-section-top pb-section-bottom">
      <WaitlistMoodProvider>
        <ArriveGroup className="relative mx-auto max-w-site rounded-reel bg-panel px-5 pt-16 pb-10 sm:px-10 lg:px-16 lg:pt-20 lg:pb-14">
          <WaitlistKaatu
            rest="wave"
            size={112}
            className="absolute -top-14 start-4 sm:start-10 lg:start-14"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-5 end-4 flex flex-col items-end gap-1 sm:end-10 lg:-top-6"
          >
            <Sticker field="pink" icon="mail" tilt={4} size="md">
              {WAITLIST_BAND.stickers.email}
            </Sticker>
            <Sticker field="lime" icon="gift" tilt={-5} size="md" delay={0.08} className="me-8">
              {WAITLIST_BAND.stickers.free}
            </Sticker>
          </div>
          <div className="grid grid-cols-1 items-end gap-x-16 gap-y-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Arrive className="flex flex-col gap-4">
              <h2 id={`band-${source}`} className="m-0 max-w-[13em] type-site-headline text-balance text-ink">
                {heading}
              </h2>
              <p className="m-0 max-w-[30em] type-site-lead text-ink-2">{WAITLIST_BAND.lead}</p>
            </Arrive>
            <Arrive>
              <WaitlistForm source={source} className="lg:max-w-none" />
            </Arrive>
          </div>
        </ArriveGroup>
      </WaitlistMoodProvider>
    </section>
  );
}
