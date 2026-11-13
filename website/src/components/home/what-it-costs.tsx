// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: what it costs · mode: Persuade · system: WEB2 Remix Vernacular
 * states: the board's own (finished in the server HTML and under reduced motion; one run when it arrives; Play again) ·
 *   A month (default) · A year (the facts beside the board follow the switch, word for word with its stickers) · the
 *   link onward: the kit's (default, hover, focus). The section arrives as the home's split sections do.
 * Two placements of one comparison. On the home, right after Your AI (what it costs follows from the AI you choose):
 * the h2 on its own, the lead (Taalcut is free; what you pay is your AI's bill), the savings in words and the way to
 * /ai/, with the board beside them and Kaatu by the zero. On /ai/, where the visitor chooses cloud or local: the same
 * board without Kaatu (the download band's Kaatu is a screen below), the facts beside it as bold-led sentences (AI1:
 * no icon-tile list on /ai/). */

import { Cloud, Laptop, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { IconText, type IconTone } from '#components/ui/icon-text';
import { Arrive, Section } from '#components/ui/section';
import { COST_SECTION, type CostPeriod } from '#content/cost';
import { cn } from '#lib/cn';
import { CostBoard } from './cost-board';
import { HomeSection } from './home-section';
import { MoreLink } from './kit';

const C = COST_SECTION;

/** The period, shared by the board and the facts beside it. */
function usePeriod() {
  const [period, setPeriod] = useState<CostPeriod>('month');
  const [switched, setSwitched] = useState(false);
  const choose = (p: CostPeriod) => {
    setPeriod(p);
    setSwitched(true);
  };
  return { period, switched, choose } as const;
}

/** The savings in words: what the board's stickers say, said in the page's words. */
function CostFacts({ period, className }: { readonly period: CostPeriod; readonly className?: string }) {
  const rows: readonly (readonly [key: string, icon: LucideIcon, tone: IconTone, words: string])[] = [
    ['cloud', Cloud, 'ai', C.savingLine('cloud', period)],
    ['local', Laptop, 'you', C.savingLine('local', period)],
  ];
  return (
    <ul data-slot="cost-facts" className={cn('m-0 flex list-none flex-col gap-3 p-0', className)}>
      {rows.map(([key, icon, tone, words]) => (
        <IconText key={key} as="li" icon={icon} tone={tone} size="lg" className="type-site-body text-pretty text-ink">
          {words}
        </IconText>
      ))}
    </ul>
  );
}

/** /ai/'s facts in the board's order, each led by its label in bold, as the page's other sections say theirs. */
function AiCostFacts({ period, className }: { readonly period: CostPeriod; readonly className?: string }) {
  return (
    <dl data-slot="cost-facts" className={cn('m-0 flex flex-col gap-5', className)}>
      {C.ai.facts(period).map(([label, value]) => (
        <div key={label} className="type-site-body text-pretty text-ink-2">
          <dt className="inline font-semibold text-ink">{label}.</dt> <dd className="inline">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The home's section, after Your AI. */
export function WhatItCosts() {
  const { period, switched, choose } = usePeriod();
  return (
    <HomeSection
      id={C.id}
      heading={C.heading}
      lead={C.lead}
      split="5/7"
      aside={
        <>
          <CostFacts period={period} />
          <MoreLink href="/ai/">{C.link}</MoreLink>
        </>
      }
    >
      <CostBoard period={period} onPeriod={choose} switched={switched} />
    </HomeSection>
  );
}

/** /ai/'s section, before the download band: the board and its facts, on the sunken ground after the profiles. */
export function CostChoices() {
  const { period, switched, choose } = usePeriod();
  return (
    <Section id={C.id} heading={C.ai.heading} lead={C.ai.lead} tone="sunken">
      <div className="grid items-start gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Arrive>
          <CostBoard period={period} onPeriod={choose} switched={switched} kaatu={false} />
        </Arrive>
        <AiCostFacts period={period} className="lg:pt-4" />
      </div>
    </Section>
  );
}
