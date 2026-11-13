// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { useEffect, useState } from 'react';
import { HERO_ATTRIBUTE } from '#lib/hero';

/** Without a hero, the nav tints once the page has scrolled this far. */
const SCROLLED = 24;

/**
 * Whether the nav is past the hero: the element marked [data-hero] has gone up under the nav, or, on a page without
 * one, the page has scrolled. False on the server and at the top of the page.
 */
export function useNavTint(pathname: string): boolean {
  const [tinted, setTinted] = useState(false);
  useEffect(() => {
    const hero = document.querySelector(`[${HERO_ATTRIBUTE}]`);
    const nav = document.querySelector('[data-slot="site-header"]');
    const navHeight = nav?.getBoundingClientRect().height ?? 64;
    if (hero && typeof IntersectionObserver !== 'undefined') {
      const observer = new IntersectionObserver(([entry]) => setTinted(!(entry?.isIntersecting ?? true)), {
        rootMargin: `-${Math.round(navHeight)}px 0px 0px 0px`,
      });
      observer.observe(hero);
      return () => observer.disconnect();
    }
    const update = () => setTinted(window.scrollY > SCROLLED);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [pathname]);
  return tinted;
}
