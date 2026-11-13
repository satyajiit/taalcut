// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* page: From your phone (/library/phone and its tabs, UX4 B17) · system: DESIGN.md v0.6 + UX4 (Page's views, Kaatu
 *   as companion) · an app route in the shell: the window bar names it, "From your phone › Wi-Fi"
 * layout: the tabs (the kit's ViewLinks, each with its glyph) in Page's views, a first-visit tip, then the one
 *   listening band on a hairline while the Mac listens or has just stopped (it says first, on every tab, that this
 *   Mac is reachable), then the open tab. Everything shares the column's edges: no tab narrows itself.
 * states: each tab's own; the band's (starting, listening, stopped, failed). Not listening at all (before the Wi-Fi
 *   tab shows): no band; the tab that needs the code says so once (Transfers' empty state, Wi-Fi's own hero)
 * motion: the tab thumb's glide; rows that arrive later rise in (Arrival); nothing ambient while it waits
 */
import { useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { Page } from '../../../../shell/page';
import { PageTip } from '../../../kaatu/page-tip';
import { connectionOf, onTheirWay } from '../session/connection';
import { usePhoneFlow } from '../session/phone-flow';
import { StatusBand } from '../status/status-band';
import { PHONE_TAB_NAMES, PhoneTabs, useOpenPhoneTab } from './phone-tabs';

/** The frame every phone tab shares: its name in the window bar, the tabs, the band. */
export function PhoneFlowFrame({ children }: { children: ReactNode }) {
  const { t, i18n } = useLingui();
  const { transfer } = usePhoneFlow();
  const open = useOpenPhoneTab();
  return (
    <Page
      title={t`From your phone`}
      {...(open
        ? {
            detail: i18n._(PHONE_TAB_NAMES[open]),
            views: <PhoneTabs arriving={onTheirWay(transfer.files)} />,
          }
        : {})}
      className="gap-7"
    >
      {/* /library/phone itself only redirects to a tab: no header to flash on the way. The tabs are the page's
          views (Page's `views`, which the page turn knows); the status band closes the header while there is
          something to say about listening. */}
      {/* The tip is about sending, so it sits on Wi-Fi; Transfers' empty state has its own Kaatu (one per page). */}
      {open === 'wifi' ? (
        <PageTip id="phone-flow">
          {t`Keep your phone’s screen on while clips send. If it sleeps, they carry on once it’s back.`}
        </PageTip>
      ) : null}
      {open && connectionOf(transfer).kind !== 'off' ? (
        <div data-slot="phone-header" className="flex flex-col gap-5 border-b border-rule-subtle pb-5">
          <StatusBand transfer={transfer} />
        </div>
      ) : null}
      {children}
    </Page>
  );
}
