// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: Premium sections · /premium/'s reading parts: what you get, from payment to active, before you order
 * mode: Read · system: WEB2 Remix Vernacular (facts as icon rows, two up; the steps as /download/ draws its own: an
 *   ordered list read left to right, each under its segment of one bar, its number in a sticker circle)
 * states: arrived (server HTML) · arriving (each section's rise) · the links inside the facts take InlineText's
 *   (default · hover · focus · visited). Not a control.
 * Every word is content/premium.ts's. The icons are picked here, one for each row, in the rows' order. */

import {
  Briefcase,
  CalendarCheck,
  CreditCard,
  Headset,
  Laptop,
  Lightbulb,
  type LucideIcon,
  MessageCircle,
  MonitorCheck,
  PackagePlus,
  Scale,
  ScreenShare,
  Wrench,
} from 'lucide-react';
import { type IconFact, IconFacts } from '#components/content/icon-facts';
import type { IconTone } from '#components/ui/icon-text';
import { Arrive, Section } from '#components/ui/section';
import { PREMIUM_PAGE } from '#content/premium';
import type { Fact } from '#content/schema';
import { ICONS } from '#lib/icons';

const P = PREMIUM_PAGE;

type RowIcon = readonly [icon: LucideIcon, tone?: IconTone];

/** What you get, in P.included.rows' order. Violet is the AI's colour, teal the visitor's own. */
const INCLUDED_ICONS: readonly RowIcon[] = [
  [MonitorCheck, 'you'],
  [ScreenShare, 'you'],
  [ICONS.model, 'ai'],
  [ICONS.make, 'ai'],
  [MessageCircle, 'beat'],
  [Lightbulb, 'beat'],
  [Briefcase, 'action'],
  [Wrench],
  [CalendarCheck],
  [PackagePlus],
];

/** Before you order, in P.notes.rows' order. */
const NOTE_ICONS: readonly RowIcon[] = [
  [Laptop],
  [ICONS.privacy],
  [Scale],
  [Lightbulb],
  [Briefcase],
  [Headset],
  [CreditCard],
];

function rows(facts: readonly Fact[], icons: readonly RowIcon[]): IconFact[] {
  return facts.map(([label, value], i) => {
    const [icon, tone] = icons[i] ?? [ICONS.info];
    return { label, value, icon, tone };
  });
}

export function PremiumIncluded() {
  return (
    <Section
      id={P.included.id}
      heading={P.included.heading}
      lead={P.included.lead}
      tone="sunken"
      className="scroll-mt-24"
    >
      <IconFacts rows={rows(P.included.rows, INCLUDED_ICONS)} columns />
    </Section>
  );
}

export function PremiumActivation() {
  return (
    <Section id={P.activation.id} heading={P.activation.heading} className="scroll-mt-24">
      <ol className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-10 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {P.activation.steps.map((step, i) => (
          <Arrive as="li" key={step.title} className="flex flex-col gap-4">
            <span aria-hidden className="flex items-center gap-3">
              <span className="inline-grid size-10 shrink-0 -rotate-3 place-items-center rounded-pill bg-sticker-paper type-sticker text-sticker-paper-ink shadow-sticker">
                {i + 1}
              </span>
              <span className="h-1.5 flex-1 rounded-pill bg-ink" />
            </span>
            <h3 className="m-0 type-site-subhead text-ink">{step.title}</h3>
            <p className="m-0 max-w-[34em] type-site-body text-pretty text-ink-2">{step.body}</p>
          </Arrive>
        ))}
      </ol>
    </Section>
  );
}

export function PremiumNotes() {
  return (
    <Section id={P.notes.id} heading={P.notes.heading} tone="sunken" className="scroll-mt-24">
      <IconFacts rows={rows(P.notes.rows, NOTE_ICONS)} columns />
    </Section>
  );
}
