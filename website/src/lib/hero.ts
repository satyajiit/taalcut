// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hero mark, in a module any component can import, server or client: a page marks its hero with this attribute,
 * and the nav (components/chrome/use-nav-tint.ts) deepens its tint once the hero has scrolled up under it. One element
 * a page carries it.
 */
export const HERO_ATTRIBUTE = 'data-hero';

/** Spread on the hero's outer element: `<section {...HERO_MARK}>`. */
export const HERO_MARK = { [HERO_ATTRIBUTE]: '' } as const;
