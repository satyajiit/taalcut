// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Bring your footage in, its showcase, its index fragment and its fact rows' scenes · mode: Operate ·
 *   system: WEB2 Remix Vernacular (teal is yours)
 * the coded app window open on Library › Import, on a Mac or on Ubuntu (the switch in its bar changes the window's
 *   controls and the ways it offers, as the app does), the ways in grouped and iconed beside the chosen way's page;
 *   Phone over Wi-Fi first: the code, the computer's question with its match code, and the owner's clips arriving
 *   at their stages; beside the window, the phone's own side of it, in the page Taalcut serves to its browser.
 *   The index's fragment is the same chooser, small, with the clips arriving
 * states: the parts' own (chooser, platform-switch, wifi-panel, way-panels, phone-side, arrivals); the stickers pop
 *   once and lean
 * motion: Phone over Wi-Fi's run is the one arrival: it plays once when scrolled to (the phone asks, Allow, the clips
 *   land and move through their stages, under five seconds), then rests; reduced motion: the finished run, at once */

import { Laptop, Smartphone, Camera, Images, Wifi, type LucideIcon } from 'lucide-react';
import { type ComponentType, useId, useState } from 'react';
import { AppWindow } from '#components/ui/app-window';
import { Sticker } from '#components/ui/sticker';
import { cn } from '#lib/cn';
import { ShowcasePlate } from '../plate';
import type { Scene } from '../vignette';
import { Chooser } from './chooser';
import { LOOK } from './meta';
import { PhoneSide } from './phone-side';
import { PlatformSwitch } from './platform-switch';
import { CameraWayScene, FolderWayScene, PhoneWayScene, PhotosWayScene } from './scenes';
import { WayPanel } from './way-panels';
import { useWifiRun, type WifiRun } from './wifi-run';
import { WifiPanel } from './wifi-panel';
import { type Platform, WAYS, wayOn, type WayId } from './ways';

/** The window's platform and the chosen way: on Ubuntu a Mac-only way falls back to Phone over Wi-Fi. */
function useImportView() {
  const [platform, setPlatform] = useState<Platform>('mac');
  const [picked, setPicked] = useState<WayId>('phone-wifi');
  return { platform, setPlatform, way: wayOn(platform, picked), choose: setPicked };
}

function WayPage({ way, run, id, compact = false }: { readonly way: WayId; readonly run: WifiRun; readonly id: string; readonly compact?: boolean }) {
  const w = WAYS[way];
  const Icon = w.icon;
  return (
    <section id={id} aria-label={w.name} data-way-page={way} className="flex min-w-0 flex-col gap-5">
      <header className="flex items-start gap-3">
        <span aria-hidden className="inline-grid size-9 shrink-0 -rotate-3 place-items-center rounded-lg bg-teal-soft text-teal-strong shadow-xs">
          <Icon className="size-4.5" />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="type-section text-ink">{w.name}</span>
          <span className="type-body text-ink-2">{w.note}</span>
        </span>
      </header>
      {way === 'phone-wifi' ? <WifiPanel run={run} compact={compact} /> : compact ? null : <WayPanel way={way} />}
    </section>
  );
}

/** The feature page's showcase: Library › Import, with the phone's side beside it. */
export function ImportShowcase() {
  const view = useImportView();
  const run = useWifiRun();
  const page = useId();
  return (
    <div className="grid grid-cols-1 items-start gap-12 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] xl:gap-14">
      <div className="relative order-2 mx-auto w-[min(15rem,68vw)] xl:sticky xl:top-24 xl:order-1 xl:w-full">
        <PhoneSide run={run} />
        <span className="pointer-events-none absolute -top-4 -right-6 [&>*]:pointer-events-auto">
          <Sticker field="sky" icon={Smartphone} tilt={5} size="sm">
            Nothing to install
          </Sticker>
        </span>
        <span className="pointer-events-none absolute -bottom-3 -left-6 [&>*]:pointer-events-auto">
          <Sticker field="teal" icon={Wifi} tilt={-4} size="sm" delay={0.12}>
            iPhone or Android
          </Sticker>
        </span>
      </div>
      <div className="order-1 min-w-0 xl:order-2">
        <AppWindow
          title="Library › Import"
          area={LOOK.area}
          size="lg"
          fit="fluid"
          platform={view.platform}
          actions={<PlatformSwitch value={view.platform} onChange={view.setPlatform} />}
        >
          <ShowcasePlate
            slug="import"
            label="Library › Import: the ways to bring footage in"
            className="grid grid-cols-1 gap-6 @min-[52rem]:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] @min-[52rem]:gap-0"
          >
            <div className="min-w-0 @min-[52rem]:pe-5">
              <Chooser platform={view.platform} chosen={view.way} onChoose={view.choose} controls={page} />
            </div>
            <div className="min-w-0 border-t border-rule-subtle pt-6 @min-[52rem]:border-t-0 @min-[52rem]:border-s @min-[52rem]:ps-6 @min-[52rem]:pt-0">
              <WayPage way={view.way} run={run} id={page} />
            </div>
          </ShowcasePlate>
        </AppWindow>
      </div>
    </div>
  );
}

/** The features index's live fragment: the ways in, small, and the clips arriving over Wi-Fi. */
export function ImportFragment() {
  const view = useImportView();
  const run = useWifiRun();
  const page = useId();
  return (
    <AppWindow
      title="Library › Import"
      area={LOOK.area}
      size="md"
      fit="fluid"
      platform={view.platform}
      actions={<PlatformSwitch value={view.platform} onChange={view.setPlatform} />}
    >
      <ShowcasePlate
        slug="import-fragment"
        label="The ways to bring footage in"
        className={cn('grid grid-cols-1 gap-5 @min-[40rem]:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]')}
      >
        <Chooser platform={view.platform} chosen={view.way} onChoose={view.choose} controls={page} compact />
        <WayPage way={view.way} run={run} id={page} compact />
      </ShowcasePlate>
    </AppWindow>
  );
}

/** Each fact's icon and scene, in the order of the feature's facts (#content/features-more). */
export const IMPORT_ROWS: readonly { readonly icon: LucideIcon; readonly Scene: ComponentType<Scene> }[] = [
  { icon: Smartphone, Scene: PhoneWayScene },
  { icon: Laptop, Scene: FolderWayScene },
  { icon: Camera, Scene: CameraWayScene },
  { icon: Images, Scene: PhotosWayScene },
];
