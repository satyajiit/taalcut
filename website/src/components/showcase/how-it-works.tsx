// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: how it works, and the next feature · mode: Read · system: WEB2 Remix Vernacular
 * how a feature works in two or three steps from #content/features: an ordered list read left to right, each step
 *   under its own segment of one bar (the site's motif: the steps are the feature's slots), its number in a sticker
 *   circle because people say steps aloud, its name and its sentence. Then the way on: the next feature as one big
 *   link with its icon chip and its summary, and the way back to every feature
 * states: steps: arrived (server HTML) · arriving (the section's rise) · the links: default · hover (the arrow steps
 *   on, the underline darkens) · focus (the base ring) · active (n/a, a link) */

import type { Route } from 'next';
import Link from 'next/link';
import { Arrive, Section } from '#components/ui/section';
import type { FeatureStep } from '#content/features';
import type { Feature } from '#content/schema';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import type { FeatureJob } from './look';
import { Rise } from './rise';

const SEGMENT: Readonly<Record<FeatureJob, string>> = {
  beat: 'bg-rose',
  you: 'bg-teal',
  ink: 'bg-ink',
  ai: 'bg-violet',
};

export function HowItWorks({
  steps,
  job,
}: {
  readonly steps: readonly FeatureStep[];
  readonly job: FeatureJob;
}) {
  return (
    <Section heading="How it works">
      <ol
        className={cn(
          'm-0 grid list-none grid-cols-1 gap-x-6 gap-y-10 p-0',
          steps.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2',
        )}
      >
        {steps.map((step, i) => (
          <Arrive as="li" key={step.title} className="flex flex-col gap-4">
            <span aria-hidden className="flex items-center gap-3">
              <span className="inline-grid size-10 shrink-0 -rotate-3 place-items-center rounded-pill bg-sticker-paper type-sticker text-sticker-paper-ink shadow-sticker">
                {i + 1}
              </span>
              <span className={cn('h-1.5 flex-1 rounded-pill', SEGMENT[job])} />
            </span>
            <h3 className="m-0 type-site-subhead text-ink">{step.title}</h3>
            <p className="m-0 max-w-[34em] type-site-body text-pretty text-ink-2">{step.body}</p>
          </Arrive>
        ))}
      </ol>
    </Section>
  );
}

export function NextFeature({ next }: { readonly next: Feature }) {
  const Arrow = ICONS.next;
  return (
    <nav aria-label="Next feature" className="px-gutter pb-section-bottom">
      <Rise className="mx-auto flex max-w-site flex-col gap-6 border-t border-rule pt-10">
        <Link
          href={`/features/${next.slug}/` as Route}
          className="group flex w-fit max-w-full items-center gap-4 rounded-2xl text-ink sm:gap-5"
        >
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-3 type-site-headline underline decoration-transparent decoration-2 underline-offset-[0.15em] transition-[text-decoration-color] duration-(--dur-micro) ease-(--ease-out) group-hover:decoration-ink">
              <span className="min-w-0">
                <span className="text-ink-3">Next: </span>
                {next.name}
              </span>
              <Arrow
                aria-hidden
                strokeWidth={ICON_STROKE}
                className="size-[0.7em] shrink-0 text-ink-3 transition-transform duration-(--dur-micro) ease-(--ease-out) group-hover:translate-x-1.5 group-hover:text-ink motion-reduce:transition-none"
              />
            </span>
          </span>
        </Link>
        <p className="m-0 max-w-[40em] type-site-lead text-ink-2">{next.summary}</p>
        <Link
          href={'/features/' as Route}
          className="inline-flex w-fit items-center gap-2 rounded-md type-site-body font-semibold text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
        >
          <ICONS.template aria-hidden strokeWidth={ICON_STROKE} className="size-4.5 text-ink-3" />
          Every feature
        </Link>
      </Rise>
    </nav>
  );
}
