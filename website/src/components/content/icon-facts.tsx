// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: icon facts · mode: Read · system: WEB2 Remix Vernacular
 * states: static · arriving (each row rises in turn with its Section's arrival, through Arrive) · links inside take
 *   InlineText's states (default, hover, focus, visited). Not a control.
 * A label and its value as a <dl>, every row led by its icon in a soft chip (a Lucide glyph, a brand's SVGL icon or
 * the AI's mark), so a page of facts reads as rows of things, never a text wall. Engines read the dl as plain
 * statements. `columns` lays the rows out two up from 768 px. */

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandIcon, type BrandIconId } from '#components/brand/brand-icon';
import { ICON_TONES, type IconTone } from '#components/ui/icon-text';
import { Arrive } from '#components/ui/section';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { InlineText } from './inline-text';

export interface IconFact {
  readonly label: string;
  readonly value: string;
  readonly icon?: LucideIcon;
  readonly brand?: BrandIconId;
  /** Any other drawn mark (the AI's). */
  readonly mark?: ReactNode;
  readonly tone?: IconTone;
}

const CHIP: Readonly<Record<IconTone, string>> = {
  current: 'bg-raised ring-1 ring-rule-subtle ring-inset',
  muted: 'bg-raised ring-1 ring-rule-subtle ring-inset',
  ai: 'bg-violet-soft',
  beat: 'bg-rose-soft',
  you: 'bg-teal-soft',
  action: 'bg-marigold-soft',
};

/** A fact's icon in its soft chip, hidden from assistive technology: the label beside it carries the meaning. */
export function FactIcon({ fact, size = 'md' }: { readonly fact: Pick<IconFact, 'icon' | 'brand' | 'mark' | 'tone'>; readonly size?: 'md' | 'lg' }) {
  const tone = fact.tone ?? 'muted';
  const Icon = fact.icon;
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-xl',
        size === 'lg' ? 'size-12' : 'size-10',
        CHIP[tone],
        ICON_TONES[tone === 'muted' ? 'current' : tone],
        tone === 'muted' ? 'text-ink-2' : '',
      )}
    >
      {Icon ? (
        <Icon strokeWidth={ICON_STROKE} className={size === 'lg' ? 'size-6' : 'size-5'} />
      ) : fact.brand ? (
        <BrandIcon id={fact.brand} className={size === 'lg' ? 'size-6' : 'size-5'} />
      ) : (
        <span className={cn('inline-flex', size === 'lg' ? 'size-6' : 'size-5')}>{fact.mark}</span>
      )}
    </span>
  );
}

export function IconFacts({ rows, columns = false, className }: { readonly rows: readonly IconFact[]; readonly columns?: boolean; readonly className?: string }) {
  return (
    <dl className={cn('m-0 grid gap-x-10 gap-y-7', columns ? 'md:grid-cols-2' : '', className)}>
      {rows.map((row) => (
        <Arrive key={row.label} className="relative flex min-w-0 flex-col gap-1 ps-14 pt-0.5">
          {/* The icon sits in the row's gutter, inside the dt: a dl's rows hold only their dt and dd. */}
          <dt data-slot="icon-text" className="type-site-body font-semibold text-ink">
            <span className="absolute top-0 left-0">
              <FactIcon fact={row} />
            </span>
            {row.label}
          </dt>
          <dd className="m-0 max-w-[40em] type-site-body text-pretty text-ink-2">
            <InlineText text={row.value} />
          </dd>
        </Arrive>
      ))}
    </dl>
  );
}
