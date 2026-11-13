// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: Matterward mark · mode: Persuade (brand) · system: WEB2 Remix Vernacular
 * states: theme-aware (the drawing for light grounds on a light page, the one for dark grounds in dark) · beside its
 *   name (aria-hidden; the words next to it carry the name) · named (role img with a label, when nothing beside it
 *   says the company). Not a control: the link around it carries hover and focus.
 * origin: Matterward Labs brand kit (public/brand/matterward/mark-on-light.svg and mark-on-dark.svg): the geometry is
 *   copied unchanged, nothing is imported from that repository. The company that makes Taalcut, credited in the
 *   footer. Its own colours stay inside the SVG, the brand-icon exception to the tokens rule, and it switches with the
 *   theme the way BrandIcon does (world.css: data-slot brand-icon, data-theme-aware, data-variant). Sized by the
 *   caller's size-* class; 1em square by default. */

import { cn } from '#lib/cn';

/** The kit's two colourways: circle and shape, for a light ground and for a dark one. */
const COLOURWAYS = {
  light: { circle: '#E85D0C', shape: '#16161A' },
  dark: { circle: '#FF7F3C', shape: '#EDEDEC' },
} as const;

/** The mark's geometry on its 100 × 100 grid: a circle and the shape that faces it. */
const SHAPE = 'M60 14 93 0v100L60 86v-9.923A39 39 0 0 0 60 23.923V14Z';

function Drawing({ variant }: { readonly variant: keyof typeof COLOURWAYS }) {
  const c = COLOURWAYS[variant];
  return (
    <svg data-variant={variant} viewBox="0 0 100 100" aria-hidden focusable="false" className="size-full">
      <circle cx="31" cy="50" r="31" fill={c.circle} />
      <path d={SHAPE} fill={c.shape} />
    </svg>
  );
}

export function MatterwardMark({ label, className }: { readonly label?: string; readonly className?: string }) {
  return (
    <span
      data-slot="brand-icon"
      data-brand="matterward"
      data-theme-aware=""
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
    >
      <Drawing variant="light" />
      <Drawing variant="dark" />
    </span>
  );
}
