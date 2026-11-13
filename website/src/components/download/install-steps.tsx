// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: install steps · /download/'s three steps and the facts beside a download
 * mode: Read · system: WEB2 Remix Vernacular (the steps as the feature pages draw theirs: an ordered list read left to
 *   right, each step under its own segment of one bar, its number in a sticker circle; then the facts as icon rows)
 * states: arrived (server HTML) · arriving (the section's rise) · the links inside the facts take InlineText's
 *   (default · hover · focus · visited). Not a control.
 * Everything here is content/release.ts's: the steps, and the facts (signed and notarized, what to expect from the
 * on-device model, the language, the release's page for its notes and checksums, the source, where to report). */

import { Bug, Languages, ScrollText, ShieldCheck, type LucideIcon } from 'lucide-react';
import { type IconFact, IconFacts } from '#components/content/icon-facts';
import { Arrive, Section } from '#components/ui/section';
import { INSTALL } from '#content/release';
import { ICONS } from '#lib/icons';

/** Each fact's icon, in INSTALL.facts' order; the source's is GitHub's own. */
const FACT_ICONS: readonly (LucideIcon | 'github')[] = [
  ShieldCheck,
  ICONS.expect,
  Languages,
  ScrollText,
  'github',
  Bug,
];

const facts: IconFact[] = INSTALL.facts.map(([label, value], i) => {
  const icon = FACT_ICONS[i] ?? ScrollText;
  return icon === 'github' ? { label, value, brand: 'github' } : { label, value, icon };
});

export function InstallSteps() {
  return (
    <Section id="install" heading={INSTALL.heading} tone="sunken">
      <ol className="m-0 grid list-none grid-cols-1 gap-x-6 gap-y-10 p-0 lg:grid-cols-3">
        {INSTALL.steps.map((step, i) => (
          <Arrive as="li" key={step.title} className="flex flex-col gap-4">
            <span aria-hidden className="flex items-center gap-3">
              <span className="inline-grid size-10 shrink-0 -rotate-3 place-items-center rounded-pill bg-sticker-paper type-sticker text-sticker-paper-ink shadow-sticker">
                {i + 1}
              </span>
              <span className="h-1.5 flex-1 rounded-pill bg-ink" />
            </span>
            <h3 className="m-0 type-site-subhead text-ink">{step.title}</h3>
            <p className="m-0 max-w-[34em] type-site-body text-pretty text-ink-2 [overflow-wrap:anywhere]">
              {step.body}
            </p>
          </Arrive>
        ))}
      </ol>
      <h3 id="expect" className="m-0 mt-20 scroll-mt-24 type-site-subhead text-ink">
        {INSTALL.factsHeading}
      </h3>
      <IconFacts rows={facts} columns className="mt-8" />
    </Section>
  );
}
