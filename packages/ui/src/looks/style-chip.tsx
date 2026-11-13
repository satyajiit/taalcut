// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: StyleChip (U8) · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * a brand kit or look named in one line: its logo (or a swatch of its main colour with the name's first letter),
 *   the name as written, its five colours as dots, "Look" for a measured look, "Default" when new videos get it
 * states: default · no logo (the swatch) · logo that won't load (the swatch, never a broken image) · default kit
 *   (the chip) · long name (truncates; the full name stays in the title) · not interactive: rows and menu items
 *   that hold it carry hover, focus, active and disabled
 * pre-emit critique: P4 H4 E4 S4 R5 V4
 */
import { useLingui } from '@lingui/react/macro';
import type { StyleKind, StyleSummary } from '@taalcut/core';
import { useState } from 'react';
import { Badge } from '#components/badge';
import { cn } from '#lib/cn';
import { UserContent } from '../cards/card-frame';

type Colours = StyleSummary['colours'];

export interface StyleChipProps {
  /** The person's name for it: shown as written. */
  readonly name: string;
  readonly colours: Colours;
  /** A URL the page can load for the logo; null shows the swatch. */
  readonly logoUrl: string | null;
  readonly kind: StyleKind;
  readonly isDefault: boolean;
  /** 'sm' for menus, 'md' for lists. */
  readonly size?: 'sm' | 'md';
  readonly className?: string;
}

const ORDER = ['primary', 'secondary', 'accent', 'text', 'background'] as const;

/** The five colours, in the order the editor lists them; decoration beside the name. */
export function ColourDots({ colours, className }: { colours: Colours; className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center gap-0.5', className)}>
      {ORDER.map((key) => (
        <span
          key={key}
          className="size-3 rounded-full border border-rule"
          style={{ backgroundColor: colours[key] }}
        />
      ))}
    </span>
  );
}

/** The logo, or a swatch of the main colour with the name's first letter when there is none (or it won't load). */
export function StyleMark({
  name,
  colours,
  logoUrl,
  size = 'md',
}: Pick<StyleChipProps, 'name' | 'colours' | 'logoUrl' | 'size'>) {
  const [broken, setBroken] = useState<string | null>(null);
  const box = cn(size === 'sm' ? 'size-5 text-2xs' : 'size-7 text-xs');
  if (logoUrl && broken !== logoUrl)
    return (
      <img
        src={logoUrl}
        alt=""
        onError={() => setBroken(logoUrl)}
        className={cn(box, 'shrink-0 rounded-sm bg-viewer object-contain')}
      />
    );
  return (
    <span
      aria-hidden
      translate="no"
      className={cn(box, 'inline-flex shrink-0 items-center justify-center rounded-sm font-semibold')}
      style={{ backgroundColor: colours.primary, color: colours.background }}
    >
      {[...name.trim()][0]?.toUpperCase() ?? ''}
    </span>
  );
}

export function StyleChip({
  name,
  colours,
  logoUrl,
  kind,
  isDefault,
  size = 'md',
  className,
}: StyleChipProps) {
  const { t } = useLingui();
  return (
    <span data-slot="style-chip" className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <StyleMark name={name} colours={colours} logoUrl={logoUrl} size={size} />
      <UserContent
        title={name}
        className={cn('min-w-0 truncate text-ink', size === 'sm' ? 'text-sm' : 'text-base font-medium')}
      >
        {name}
      </UserContent>
      <ColourDots colours={colours} />
      {kind === 'look' ? (
        <Badge shape="chip" tone="neutral">
          {t`Look`}
        </Badge>
      ) : null}
      {isDefault ? (
        <Badge shape="chip" tone="primary">
          {t`Default`}
        </Badge>
      ) : null}
    </span>
  );
}
