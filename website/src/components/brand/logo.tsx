// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: logo · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 (logo kit) · states: n/a
 * The drawn lockup from design/logo/kit/svg, copied to public/brand by scripts/brand-assets.mjs. Never "taalcut"
 * set in Onest. Two colourways, one per theme, swapped by the tokens' data-theme. */

import { cn } from '#lib/cn';

export interface LogoProps {
  /** `horizontal`, the lockup (default), or `symbol`, the Avartan alone (the app window's bar, a small space). */
  readonly kind?: 'horizontal' | 'symbol';
  /** `two-colour` in chrome (the UI default), `four-colour` for brand moments (DESIGN.md › Typography, Logo). */
  readonly colourway?: 'two-colour' | 'four-colour';
  /** `small` is the kit's drawing for 100–159 px wide lockups. */
  readonly size?: 'small' | 'regular';
  readonly className?: string;
}

export function Logo({ kind = 'horizontal', colourway = 'two-colour', size = 'regular', className }: LogoProps) {
  const symbol = kind === 'symbol';
  const base = symbol ? `/brand/taalcut-symbol-small-${colourway}` : `/brand/taalcut-horizontal${size === 'small' ? '-small' : ''}-${colourway}`;
  const width = symbol ? 256 : 905;
  return (
    <span className={cn('inline-flex', className)}>
      <img src={`${base}-light.svg`} alt="Taalcut" className="h-full w-auto dark:hidden" width={width} height={256} />
      <img src={`${base}-dark.svg`} alt="Taalcut" className="hidden h-full w-auto dark:block" width={width} height={256} />
    </span>
  );
}
