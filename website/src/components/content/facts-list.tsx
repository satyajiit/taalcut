// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: facts list · a label and its value as a <dl>, which readers scan and engines read as plain statements.
 * mode: Read · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 · states: n/a (static; links inside take InlineText's states)
 * Hairline-divided rows; the label column is 12rem from 640 px up and stacks above the value below it. */

import type { Fact } from '#content/schema';
import { cn } from '#lib/cn';
import { InlineText } from './inline-text';

export function FactsList({ facts, className }: { readonly facts: readonly Fact[]; readonly className?: string }) {
  return (
    <dl className={cn('m-0 divide-y divide-rule-subtle border-y border-rule-subtle', className)}>
      {facts.map(([label, value]) => (
        <div key={label} className="grid grid-cols-1 gap-x-8 gap-y-1 py-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <dt className="type-label text-ink-2">{label}</dt>
          <dd className="m-0 type-site-body text-ink">
            <InlineText text={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
