// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: brand mark · mode: Persuade · system: WEB2 Remix Vernacular
 * states: icon + name (SVGL has the brand) · name only (it doesn't: svgl/manifest.ts SVGL_MISSING)
 * <BrandMark id name />: another company's name in words, always, in the type and colour around it (the row sets
 * them; this sets neither), after its real icon from SVGL in colour (BrandIcon, theme-aware). The icon is 1em, sits on
 * the line and never parts from the name across a line; it is aria-hidden, since the name is what reads. Its size is
 * the font's: a height class from a caller has no effect (h-auto!). className is for placement and, where the row
 * sets none, type. */

import { cn } from '#lib/cn';
import { BrandIcon, isBrandIconId } from './brand-icon';

export function BrandMark({ id, name, className }: { readonly id?: string; readonly name: string; readonly className?: string }) {
  const icon = isBrandIconId(id) ? id : undefined;
  return (
    <span
      data-slot="brand-mark"
      data-mark={icon}
      className={cn('inline-flex h-auto! items-center gap-[0.4em] whitespace-nowrap', className)}
    >
      {icon ? <BrandIcon id={icon} className="size-[1em] -translate-y-px" /> : null}
      {name}
    </span>
  );
}
