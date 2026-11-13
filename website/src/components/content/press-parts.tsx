// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: press kit parts · mode: Act (downloads and copies) · system: WEB2 Remix Vernacular
 * states: logo tile resting · hover (the drawing lifts 4 px: transform only; none under reduced motion) · download
 *   link default · hover · focus (base ring) · active (2 % give) · the copy buttons' own (copy-button.tsx) · arriving
 *   (rows and tiles rise with their Section) · without JavaScript (every link works; copy buttons wait for it)
 * The press kit's pieces: the descriptions with copy buttons, each logo drawing previewed on the ground it is made for
 * (white for the light drawings, the viewer's near-black for the dark, in both themes) with its SVG, the logo's four
 * colours with their jobs and their light and dark values to copy, and the rules as do rows. */

import { Check, Download } from 'lucide-react';
import { buttonClasses } from '#components/ui/button';
import { Arrive } from '#components/ui/section';
import { PRESS } from '#content/press';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { logoColours } from '#lib/og/palette';
import { CopyButton } from './copy-button';

const DOWNLOAD = buttonClasses('secondary', 'md', 'h-9 gap-1.5 px-3.5 type-label-sm');

export function Descriptions() {
  return (
    <ul className="m-0 flex list-none flex-col gap-4 p-0">
      {PRESS.descriptions.map((d) => (
        <Arrive key={d.id} as="li" className="flex flex-col gap-3 rounded-reel bg-raised p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:gap-8 sm:p-6">
          <span className="flex min-w-0 flex-col gap-1.5">
            <span className="type-label font-semibold text-ink-2">{d.label}</span>
            <span className="max-w-[44em] type-site-body text-pretty text-ink select-all">{d.text}</span>
          </span>
          <CopyButton text={d.text} what={`the description ${d.label.toLowerCase()}`} size="sm" className="shrink-0" />
        </Arrive>
      ))}
    </ul>
  );
}

export function LogoTiles() {
  return (
    <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2">
      {PRESS.logos.map((logo) => (
        <Arrive key={logo.href} as="li" className="group flex flex-col gap-4 rounded-reel bg-raised p-3 pb-5 shadow-sm">
          <span className={cn('grid aspect-[16/7] place-items-center rounded-[calc(var(--radius-reel)-0.5rem)] px-[14%]', logo.ground === 'light' ? 'bg-sticker-cut ring-1 ring-rule-subtle ring-inset' : 'bg-viewer')}>
            <img
              src={logo.href}
              alt=""
              width={905}
              height={256}
              className="h-auto w-full transition-transform duration-(--dur-short) ease-(--ease-out) group-hover:-translate-y-1 motion-reduce:transition-none motion-reduce:group-hover:transform-none"
            />
          </span>
          <span className="flex flex-wrap items-center justify-between gap-3 px-2">
            <span className="type-label font-semibold text-ink">{logo.label}</span>
            <a href={logo.href} download className={DOWNLOAD}>
              <Download aria-hidden strokeWidth={ICON_STROKE} className="size-3.5" />
              SVG
              <span className="sr-only">: logo, {logo.label.toLowerCase()}</span>
            </a>
          </span>
        </Arrive>
      ))}
    </ul>
  );
}

const SWATCH = ['bg-logo-1', 'bg-logo-2', 'bg-logo-3', 'bg-logo-4'] as const;

export function Colours() {
  const values = logoColours();
  return (
    <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-4">
      {PRESS.colours.map((c, i) => {
        const v = values[i]!;
        return (
          <Arrive key={c.token} as="li" className="flex flex-col gap-4 rounded-reel bg-raised p-3 pb-5 shadow-sm">
            <span aria-hidden className={cn('block aspect-[4/3] rounded-[calc(var(--radius-reel)-0.5rem)]', SWATCH[i])} />
            <span className="flex flex-col gap-1 px-2">
              <span className="type-site-subhead text-ink">{c.name}</span>
              <span className="type-body text-pretty text-ink-2">{c.job}</span>
            </span>
            <dl className="m-0 flex flex-col gap-2 px-2">
              {(['light', 'dark'] as const).map((ground) => (
                <div key={ground} className="flex items-center justify-between gap-3">
                  <dt className="type-meta text-ink-2">On {ground}</dt>
                  <dd className="m-0 inline-flex items-center gap-2">
                    <code className="type-timecode text-ink select-all">{v[ground]}</code>
                    <CopyButton text={v[ground]} what={`${c.name.toLowerCase()} for ${ground} grounds`} size="sm" />
                  </dd>
                </div>
              ))}
            </dl>
          </Arrive>
        );
      })}
    </ul>
  );
}

export function Rules({ items }: { readonly items: readonly string[] }) {
  return (
    <ul className="m-0 grid list-none gap-x-10 gap-y-4 p-0 md:grid-cols-2">
      {items.map((rule) => (
        <Arrive key={rule} as="li" className="flex items-start gap-3">
          <span aria-hidden className="mt-0.5 inline-grid size-7 shrink-0 place-items-center rounded-pill bg-teal-soft text-teal-strong">
            <Check strokeWidth={ICON_STROKE} className="size-4" />
          </span>
          <span className="max-w-[38em] type-site-body text-pretty text-ink">{rule}</span>
        </Arrive>
      ))}
    </ul>
  );
}

export function Files() {
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-rule-subtle border-y border-rule-subtle p-0">
      {PRESS.files.map((f) => (
        <Arrive key={f.href} as="li" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-4">
          <span className="inline-flex min-w-0 items-center gap-3 type-site-body text-ink">
            <span aria-hidden className="inline-grid size-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-2">
              <Download strokeWidth={ICON_STROKE} className="size-4" />
            </span>
            {f.label}
          </span>
          <a href={f.href} download className={DOWNLOAD}>
            <Download aria-hidden strokeWidth={ICON_STROKE} className="size-3.5" />
            {f.format}
            <span className="sr-only">: {f.label}</span>
          </a>
        </Arrive>
      ))}
    </ul>
  );
}
