// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: site header · mode: Persuade (site chrome) · system: WEB2 Remix Vernacular
 * states: at the top (the ground's own colour) · past the hero (the tint deepens: panel, a hairline and a soft
 *   shadow) · links: default (ink-2) · hover (hover surface, ink) · focus (base ring) · active (pressed) · current
 *   (aria-current: ink on the hover surface, its icon in ink) · Join: outlined (ink border), hover and active fill
 *   with ink (inverse) · menu closed · menu open (phones: a sheet under the bar with every link and Join; focus moves
 *   to its first link; Escape closes it and returns focus to the button; any link closes it)
 * Solid, never glass; it sticks. The mark (the drawn lockup, with its motion), Features, Your AI and Platforms with
 * their icons, the theme switch, and Join the waitlist outlined: the page's own waitlist button holds the one
 * marigold fill. */

import { ArrowRight, Cpu, LayoutGrid, MonitorSmartphone, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { HeaderMark } from '#components/brand/header-mark';
import { NAV } from '#content/site';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { useUiStore } from '#stores/ui';
import { ThemeToggle } from './theme-toggle';
import { useNavTint } from './use-nav-tint';

/** Each nav link's glyph, by its address. */
export const NAV_ICONS: Readonly<Record<(typeof NAV)[number]['href'], LucideIcon>> = {
  '/features/': LayoutGrid,
  '/ai/': Cpu,
  '/download/': MonitorSmartphone,
};

function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/' && pathname.startsWith(href));
}

const JOIN =
  'inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-pill border-[1.5px] border-ink px-4 type-label font-semibold text-ink ' +
  'transition-[background-color,color,transform] duration-(--dur-micro) ease-(--ease-out) hover:bg-inverse hover:text-on-inverse ' +
  'active:scale-[0.98] motion-reduce:active:scale-100';

export function SiteHeader() {
  const pathname = usePathname() ?? '/';
  const open = useUiStore((s) => s.menuOpen);
  const setOpen = useUiStore((s) => s.setMenuOpen);
  const tinted = useNavTint(pathname);
  const menu = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname, setOpen]);
  useEffect(() => {
    if (!open) return undefined;
    menu.current?.querySelector<HTMLElement>('a')?.focus();
    // Escape closes the sheet and hands focus back to the button that opened it, never to a hidden link.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      toggle.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);
  const MenuIcon = open ? ICONS.close : ICONS.menu;

  return (
    <header
      data-slot="site-header"
      data-tinted={tinted || undefined}
      className={cn(
        'sticky top-0 z-40 border-b border-transparent bg-canvas transition-[background-color,border-color,box-shadow] duration-(--dur-short) ease-(--ease-out)',
        'data-tinted:border-rule-subtle data-tinted:bg-panel data-tinted:shadow-sm',
      )}
    >
      <nav aria-label="Main" className="mx-auto flex h-nav max-w-site items-center gap-1 px-gutter">
        <Link href="/" aria-label="Taalcut home" className="me-3 inline-flex h-7 shrink-0 items-center rounded-sm sm:me-6">
          <HeaderMark className="aspect-[905/256] h-7" />
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const Icon = NAV_ICONS[item.href];
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                  className={cn(
                    'group inline-flex h-10 items-center gap-2 rounded-pill px-3.5 type-label font-semibold text-ink-2',
                    'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover hover:text-ink active:bg-pressed',
                    'aria-[current=page]:bg-hover aria-[current=page]:text-ink',
                  )}
                >
                  <Icon aria-hidden strokeWidth={ICON_STROKE} className="size-4 text-ink-3 transition-colors group-hover:text-ink group-aria-[current=page]:text-ink" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <span className="ms-auto" />
        <ThemeToggle />
        {/* Wrapped: a link's own inline-flex would beat `hidden` at equal specificity. */}
        <span className="hidden ps-2 sm:contents">
          <Link href="/waitlist/" className={JOIN}>
            Join the waitlist
            <ArrowRight aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
          </Link>
        </span>
        <button
          ref={toggle}
          type="button"
          className="inline-grid size-10 place-items-center rounded-pill text-ink-2 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover hover:text-ink active:bg-pressed md:hidden"
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen(!open)}
        >
          <MenuIcon aria-hidden size={20} strokeWidth={ICON_STROKE} />
        </button>
      </nav>
      <div id="site-menu" ref={menu} hidden={!open} className="border-t border-rule-subtle bg-canvas px-gutter pt-2 pb-5 shadow-md md:hidden">
        <ul className="mx-auto flex max-w-site flex-col">
          {NAV.map((item) => {
            const Icon = NAV_ICONS[item.href];
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                  className="flex h-12 items-center gap-3 rounded-xl px-3 type-label font-semibold text-ink hover:bg-hover active:bg-pressed aria-[current=page]:bg-hover"
                >
                  <Icon aria-hidden strokeWidth={ICON_STROKE} className="size-5 text-ink-2" />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li className="pt-3">
            <Link href="/waitlist/" className={cn(JOIN, 'h-12 w-full justify-center')}>
              Join the waitlist
              <ArrowRight aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
            </Link>
          </li>
        </ul>
      </div>
    </header>
  );
}
