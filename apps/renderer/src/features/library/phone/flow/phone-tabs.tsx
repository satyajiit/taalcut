// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: the phone flow's tabs · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (the kit's ViewLinks)
 * the kit's ViewLinks (each tab is a route), each led by its concept's icon: the open tab on the shared thumb
 *   (rule-strong edge), which glides between them on transform alone (--dur-short, --ease-out, no overshoot);
 *   Transfers carries a count of what is on its way
 * states: the kit's ViewLink: default · hover · focus (base ring, instant) · active (gives by 2 %) · current
 *   (aria-current="page", the thumb) · disabled, loading, error, success: n/a (a tab is always reachable; the tab's
 *   page says its state)
 * reduced motion: the thumb moves at once (base.css)
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { cn, CONCEPT_ICONS, ViewLink, ViewLinks, type IconComponent } from '@taalcut/ui';
import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { PhoneTab } from '../session/connection';

export const PHONE_TAB_PATHS = {
  wifi: '/library/phone/wifi',
  cable: '/library/phone/cable',
  transfers: '/library/phone/transfers',
  help: '/library/phone/help',
} as const satisfies Record<PhoneTab, string>;

export type PhoneTabPath = (typeof PHONE_TAB_PATHS)[PhoneTab];

/** Each tab's name: the tab's label and, after the bar's chevron, its title. */
export const PHONE_TAB_NAMES: Readonly<Record<PhoneTab, MessageDescriptor>> = {
  wifi: msg`Wi-Fi`,
  cable: msg`Cable`,
  transfers: msg`Transfers`,
  help: msg`Help`,
};

const ORDER: readonly PhoneTab[] = ['wifi', 'cable', 'transfers', 'help'];

/** Each tab's concept glyph (the kit's icon registry). */
const ICONS: Readonly<Record<PhoneTab, IconComponent>> = {
  wifi: CONCEPT_ICONS.wifi,
  cable: CONCEPT_ICONS.cable,
  transfers: CONCEPT_ICONS.transfer,
  help: CONCEPT_ICONS.help,
};

/** An inline link's look in the phone flow: ink, a quiet underline that darkens on hover. */
export const INLINE_LINK = cn(
  'font-medium text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink',
);

/** Words that open another tab of the flow, as an inline link (a view of one flow: it replaces the entry). */
export const tabLink = (to: PhoneTabPath) => (children: ReactNode) => (
  <Link to={to} replace className={INLINE_LINK}>
    {children}
  </Link>
);

/** The tab whose route is open, if any. */
export function useOpenPhoneTab(): PhoneTab | null {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return ORDER.find((tab) => pathname.startsWith(PHONE_TAB_PATHS[tab])) ?? null;
}

export function PhoneTabs({ arriving }: { arriving: number }) {
  const { t, i18n } = useLingui();
  const open = useOpenPhoneTab();
  return (
    <ViewLinks label={t`From your phone`} data-slot="phone-tabs">
      {ORDER.map((tab) => (
        <ViewLink
          key={tab}
          asChild
          current={open === tab}
          icon={ICONS[tab]}
          count={tab === 'transfers' ? arriving : undefined}
          data-tab={tab}
        >
          {/* A tab is a view of one flow: switching replaces the entry, so Back leaves the flow. */}
          <Link to={PHONE_TAB_PATHS[tab]} replace>
            {i18n._(PHONE_TAB_NAMES[tab])}
          </Link>
        </ViewLink>
      ))}
    </ViewLinks>
  );
}
