// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: offer stickers · the waitlist's offer as a row of tilted stickers under /waitlist/'s h1
 * mode: Persuade · system: WEB2 Remix Vernacular (stickers carry facts; the brand icons in colour)
 * states: arriving (each pops in, a beat after the last) · resting · leaning toward a fine pointer · reduced motion
 *   (resting). Decorative: the page's words and its facts card say each of these in full. */

import { Sticker } from '#components/ui/sticker';
import { WAITLIST_BAND } from '#content/waitlist';
import { cn } from '#lib/cn';

export function OfferStickers({ className }: { readonly className?: string }) {
  return (
    <div aria-hidden className={cn('flex flex-wrap items-center gap-2', className)}>
      <Sticker field="pink" icon="mail" tilt={-4}>
        {WAITLIST_BAND.stickers.email}
      </Sticker>
      <Sticker field="lime" icon="gift" tilt={3} delay={0.06}>
        {WAITLIST_BAND.stickers.free}
      </Sticker>
      <Sticker field="sky" brand="apple" tilt={-2} delay={0.12}>
        {WAITLIST_BAND.stickers.mac}
      </Sticker>
      <Sticker field="paper" brand="ubuntu" tilt={4} delay={0.18}>
        {WAITLIST_BAND.stickers.ubuntu}
      </Sticker>
    </div>
  );
}
