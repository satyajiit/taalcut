// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: Product Hunt badge · system: WEB2 Remix Vernacular · states: default · hover (lifts) · focus (the base
 *   ring) · opens Product Hunt in a new tab
 * Product Hunt's own "Find us on Product Hunt" badge (light and dark, swapped by the theme like the logo), served
 * from public/badges. Their embed loads from api.producthunt.com with a live upvote count; this site loads nothing
 * from a third party until the visitor acts (the launch film waits for a press of play), so the badge is a copy
 * without the count, which a copy would freeze. The link is the only thing that reaches Product Hunt. */

import { SITE } from '#content/site';
import { cn } from '#lib/cn';

export function ProductHuntBadge({ className }: { readonly className?: string }) {
  return (
    <a
      href={SITE.productHunt.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={SITE.productHunt.label}
      data-slot="product-hunt-badge"
      className={cn(
        'inline-flex w-fit rounded-[10px] transition-[translate,box-shadow] duration-(--dur-micro) ease-(--ease-out) hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      <img src="/badges/product-hunt-light.svg" alt="" width={200} height={54} className="h-[2.75rem] w-auto dark:hidden" />
      <img src="/badges/product-hunt-dark.svg" alt="" width={200} height={54} className="hidden h-[2.75rem] w-auto dark:block" />
    </a>
  );
}
