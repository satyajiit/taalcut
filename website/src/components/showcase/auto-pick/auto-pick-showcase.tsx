// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: auto-pick showcase · mode: Operate · system: WEB2 Remix Vernacular
 * two coded app windows in the order a creator meets them: the library, open on the camera roll by day and searched
 *   in plain words, with the template's slot beside it holding the AI's pick, how sure it is and three other shots;
 *   and, under it as a second window on the desktop, the small one that pairs a phone. Teal marks the roll as yours, with its
 *   word; violet the AI's pick
 * states: the regions' own (library-search, slot-pick, phone-pairing); the stickers pop once and lean */

import { Smartphone, Wifi } from 'lucide-react';
import { AppWindow } from '#components/ui/app-window';
import { Sticker } from '#components/ui/sticker';
import { Chip } from '../chip';
import { SHOWCASE_ICONS } from '../icons';
import { ShowcasePlate } from '../plate';
import { LibrarySearch } from './library-search';
import { PhoneMock } from './phone-mock';
import { PhonePairing } from './phone-pairing';
import { SAMPLE_ROLL } from './roll';
import { SlotPick } from './slot-pick';

export function AutoPickShowcase() {
  const Phone = SHOWCASE_ICONS.phone;
  return (
    <div className="flex flex-col gap-12">
      <AppWindow
        title="Camera roll"
        area="library"
        size="lg"
        fit="fluid"
        actions={
          <Chip tone="you">
            <Phone aria-hidden />
            Yours, indexed on your computer
          </Chip>
        }
      >
        <div className="grid grid-cols-1 @min-[64rem]:grid-cols-[minmax(0,1fr)_minmax(0,17rem)]">
          <ShowcasePlate
            slug="auto-pick"
            label="A camera roll, searched in plain words"
            className="flex flex-col gap-4"
          >
            <h3 className="m-0 type-page-title text-ink">Your camera roll</h3>
            <LibrarySearch clips={SAMPLE_ROLL} />
          </ShowcasePlate>
          <ShowcasePlate
            slug="auto-pick-slot"
            label="A slot of the template and its pick"
            className="border-t border-rule-subtle bg-panel @min-[64rem]:border-t-0 @min-[64rem]:border-s"
          >
            <SlotPick />
          </ShowcasePlate>
        </div>
      </AppWindow>
      <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-[minmax(0,15rem)_minmax(0,24rem)] md:justify-center md:gap-16">
        <div className="relative mx-auto w-[min(15rem,70vw)] md:w-full">
          <PhoneMock />
          <span
            aria-hidden
            className="absolute top-1/2 -right-14 hidden -translate-y-1/2 items-center gap-1 text-teal-strong md:flex"
          >
            <span className="h-0.5 w-3 rounded-pill bg-teal" />
            <span className="h-0.5 w-3 rounded-pill bg-teal" />
            <span className="h-0.5 w-3 rounded-pill bg-teal" />
          </span>
        </div>
        <div className="relative mx-auto w-full max-w-sm">
          <AppWindow
            title="Add from your phone"
            area="library"
            size="sm"
            sidebar={false}
            fit="fluid"
          >
            <ShowcasePlate
              slug="auto-pick-phone"
              label="The phone’s pairing screen"
              className="flex flex-col gap-4"
            >
              <h3 className="m-0 type-section text-ink">Clips from your phone</h3>
              <PhonePairing />
            </ShowcasePlate>
          </AppWindow>
          <span className="pointer-events-none absolute -top-5 -right-2 [&>*]:pointer-events-auto">
            <Sticker field="teal" icon={Wifi} tilt={5}>
              Over your Wi-Fi
            </Sticker>
          </span>
          <span className="pointer-events-none absolute -bottom-4 -left-3 [&>*]:pointer-events-auto">
            <Sticker field="sky" icon={Smartphone} tilt={-4} delay={0.12}>
              Nothing to install on the phone
            </Sticker>
          </span>
        </div>
      </div>
    </div>
  );
}
