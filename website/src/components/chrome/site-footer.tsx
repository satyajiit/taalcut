// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: site footer · mode: Persuade (site chrome) · system: WEB2 Remix Vernacular
 * states: links default (ink-2, their icons ink-3) · hover (ink, underline, the icon in ink) · focus (base ring) ·
 *   active (pressed surface) · GitHub is words, not a link, until the repository opens with the beta
 * A band on the sunken ground, never a link list on blank paper: the template's segment bar as its motif, the
 * four-colour lockup and one line, the platform row (Apple, Ubuntu and Windows by SVGL icon and name), Instagram and
 * GitHub, three groups of links each with its icon, Kaatu waving from the band's top edge (inside the band on a phone,
 * clear of the sticky nav), and the base line: the licence, the company's credit (its small mark and words, linking
 * to its site, quieter than Taalcut's lockup), the analytics switch in the credit's own type (after hydration, in a
 * build that counts visits) and the © line in the company's name. */

import {
  Cpu,
  FileText,
  FlaskConical,
  Info,
  LayoutGrid,
  ListPlus,
  Mail,
  MessageCircleQuestion,
  MonitorSmartphone,
  Newspaper,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Logo } from '#components/brand/logo';
import { MatterwardMark } from '#components/brand/matterward-mark';
import { AnalyticsSwitch } from '#components/chrome/analytics';
import { Kaatu } from '#components/kaatu/kaatu';
import { IconText } from '#components/ui/icon-text';
import { SegmentBar } from '#components/ui/segment-bar';
import { COMPANY_CREDIT, COPYRIGHT_LINE, FOOTER_GROUPS, FOOTER_LINE, FOOTER_PLATFORMS, LICENCE_LINE, SITE } from '#content/site';
import { type Segment } from '#components/ui/segments';

type FooterHref = (typeof FOOTER_GROUPS)[number]['links'][number]['href'];

/** Each footer link's glyph, by its address. */
const LINK_ICONS: Readonly<Record<FooterHref, LucideIcon>> = {
  '/features/': LayoutGrid,
  '/ai/': Cpu,
  '/download/': MonitorSmartphone,
  '/faq/': MessageCircleQuestion,
  '/about/': Info,
  '/press/': Newspaper,
  '/contact/': Mail,
  '/waitlist/': ListPlus,
  '/privacy/': ShieldCheck,
  '/terms/': FileText,
  '/beta-terms/': FlaskConical,
};

/** The footer's motif: a template of thirteen slots in four parts, filled, with its music beats. */
const MOTIF: readonly Segment[] = (['hook', 'hook', 'hook', 'build', 'build', 'build', 'peak', 'peak', 'peak', 'peak', 'outro', 'outro', 'outro'] as const).map(
  (group, i) => ({ start: i, end: i + 1, group }),
);
const MOTIF_BEATS = Array.from({ length: 23 }, (_, i) => Number(((i * 13) / 23 + 0.2).toFixed(2)));

const LINK_BASE =
  'group inline-flex min-h-8 items-center rounded-md text-ink-2 underline-offset-4 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:text-ink hover:underline active:bg-pressed';
const LINK = `${LINK_BASE} type-label`;
/** The company's credit: the base line's size, so it stays quieter than Taalcut's lockup and links. */
const CREDIT = `${LINK_BASE} gap-2 type-meta`;

export function SiteFooter() {
  return (
    <footer data-slot="site-footer" className="relative mt-16 border-t border-rule-subtle bg-sunken">
      <div className="relative mx-auto max-w-site px-gutter pt-14 pb-8">
        {/* On the band's top edge from 640 px; on a phone, inside the band beside the motif, so a footer scrolled up to
            the sticky nav never hides it behind the nav. */}
        <Kaatu
          pose="big-wave"
          size={96}
          interactive
          sticker
          className="absolute -top-[4.25rem] right-[max(1rem,6vw)] rotate-6 max-sm:top-4 max-sm:right-3 max-sm:[--kaatu-size:4.5rem]"
        />
        <SegmentBar decorative segments={MOTIF} beats={MOTIF_BEATS} state="filled" tone="surface" labels numbers className="max-w-xl max-sm:w-[calc(100%-5rem)]" />
        <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col gap-6">
            <Logo colourway="four-colour" className="h-10 sm:h-12" />
            <p className="max-w-[24em] type-site-lead text-ink">{FOOTER_LINE}</p>
            <ul aria-label="Platforms" className="flex flex-wrap gap-x-5 gap-y-2">
              {FOOTER_PLATFORMS.map((p) => (
                <IconText key={p.brand} as="li" brand={p.brand} className="type-label text-ink">
                  {p.label}
                </IconText>
              ))}
            </ul>
            <ul aria-label="Taalcut elsewhere" className="flex flex-wrap gap-x-5 gap-y-2">
              <li>
                <a href={SITE.instagram.url} rel="me noopener noreferrer" target="_blank" className={LINK}>
                  <IconText brand="instagram">
                    Instagram <span className="text-ink-3">{SITE.instagram.handle}</span>
                  </IconText>
                </a>
              </li>
              <li>
                {SITE.repositoryPublic ? (
                  <a href={SITE.repository} rel="noopener noreferrer" target="_blank" className={LINK}>
                    <IconText brand="github">GitHub</IconText>
                  </a>
                ) : (
                  <span className="inline-flex min-h-8 items-center type-label text-ink-2">
                    <IconText brand="github">GitHub, opens with the beta</IconText>
                  </span>
                )}
              </li>
            </ul>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3">
            {FOOTER_GROUPS.map((group) => (
              <div key={group.heading}>
                <h2 className="type-label font-bold text-ink">{group.heading}</h2>
                <ul className="mt-3 flex flex-col gap-1">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={LINK}>
                        <IconText icon={LINK_ICONS[link.href]} tone="muted">
                          {link.label}
                        </IconText>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mt-14 flex flex-col gap-3 border-t border-rule pt-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
          <p className="type-meta text-pretty text-ink-2">{LICENCE_LINE}</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <a href={SITE.company.url} aria-label={COMPANY_CREDIT.name} data-slot="company-credit" className={CREDIT}>
              <MatterwardMark className="size-4.5" />
              {COMPANY_CREDIT.label}
            </a>
            <AnalyticsSwitch className={CREDIT} />
            <p className="type-meta text-ink-2">{COPYRIGHT_LINE}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
