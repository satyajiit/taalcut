// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: brand icon · mode: Persuade · system: WEB2 Remix Vernacular
 * states: theme-aware (the light drawing on a light page, the dark one in dark, where SVGL has both) · fixed (one
 *   drawing whatever the theme: `on="dark"` for a dark surface such as video, `on="light"` for a sticker) · named
 *   (role img with a label) · beside its name (aria-hidden; the words next to it carry the name)
 * Another company's real icon, from SVGL (scripts/svgl.mjs → ./svgl), in its own colours, unchanged. Never drawn by
 * us: a brand SVGL lacks is its name in words (svgl/manifest.ts SVGL_MISSING). Either the icon is named (`label`) or
 * it sits beside its name in words (BrandMark, IconText). Sized by `size` (px) or by the caller's size-* class;
 * 1em square by default (world.css, at zero specificity under the utilities, so any size-* the caller passes wins),
 * so it follows the text it sits in. */

import { cn } from '#lib/cn';
import { SVGL, SVGL_MISSING, type BrandIconId } from './svgl/manifest';
import { BRAND_DRAWINGS } from './svgl/registry';

export type { BrandIconId };

export interface BrandIconProps {
  readonly id: BrandIconId;
  /** Width and height in px. Leave it out to size from className (size-4) or the text (1em). */
  readonly size?: number;
  /** Follow the page's theme (default). Off, the drawing for the `on` surface shows in both themes. */
  readonly themeAware?: boolean;
  /** The surface the icon sits on when it isn't theme-aware: a light sticker or a dark video. */
  readonly on?: 'light' | 'dark';
  /** The icon's accessible name, when no words beside it say the brand. */
  readonly label?: string;
  readonly className?: string;
}

/** True when SVGL has an icon for this id. */
export function isBrandIconId(id: string | undefined): id is BrandIconId {
  return id !== undefined && Object.hasOwn(BRAND_DRAWINGS, id);
}

/** The brand's name as the manifest writes it (SVGL's entry, or the missing list). */
export function brandName(id: string): string | undefined {
  return SVGL.find((e) => e.id === id)?.name ?? SVGL_MISSING.find((e) => e.id === id)?.name;
}

export function BrandIcon({ id, size, themeAware = true, on = 'light', label, className }: BrandIconProps) {
  const drawings = BRAND_DRAWINGS[id];
  const Light = drawings.light;
  const Dark = drawings.dark;
  const fixed = !themeAware || !Dark;
  const Only = fixed ? (on === 'dark' && Dark ? Dark : Light) : null;
  return (
    <span
      data-slot="brand-icon"
      data-brand={id}
      data-theme-aware={fixed ? undefined : ''}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      style={size === undefined ? undefined : { width: size, height: size }}
    >
      {Only ? (
        <Only data-variant="only" aria-hidden focusable="false" className="block size-full" />
      ) : (
        <>
          <Light data-variant="light" aria-hidden focusable="false" className="size-full" />
          {Dark ? <Dark data-variant="dark" aria-hidden focusable="false" className="size-full" /> : null}
        </>
      )}
    </span>
  );
}
