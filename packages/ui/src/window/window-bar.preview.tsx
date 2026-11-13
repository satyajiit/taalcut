// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · preview: the window bar in each of its arrangements. Shown on /dev/kit; not used by any page. */
import { useLingui } from '@lingui/react/macro';
import { PanelLeft, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '#components/button';
import { UserContent } from '../cards/card-frame';
import { WindowBar, WindowTitle } from './window-bar';
import { WindowControls } from './window-controls';

const noop = () => {};
// Sample content: a chat's name, shown as written (never translated).
const SAMPLE_CHAT = 'Trip to Goa reel';

function Frame({ label, inactive, children }: { label: string; inactive?: boolean; children: ReactNode }) {
  return (
    <figure className="m-0 flex flex-col gap-1.5">
      <div
        className="overflow-hidden rounded-lg border border-rule"
        {...(inactive ? { 'data-window-active': 'false' } : {})}
      >
        {children}
      </div>
      <figcaption className="text-xs text-ink-3">{label}</figcaption>
    </figure>
  );
}

/** The bar beside a sidebar and beside its icon rail, alone (onboarding), inactive, and in full screen. */
export function WindowBarPreview() {
  const { t } = useLingui();
  const toggle = (expanded: boolean) => (
    <Button variant="ghost" size="icon" className="size-7" aria-label={t`Sidebar`} aria-expanded={expanded}>
      <PanelLeft aria-hidden />
    </Button>
  );
  const sidebarButton = toggle(true);
  const title = (
    <WindowTitle
      as="p"
      title={t`Agent`}
      detail={<UserContent className="whitespace-nowrap">{SAMPLE_CHAT}</UserContent>}
    />
  );
  const actions = (
    <Button size="sm">
      <Plus aria-hidden />
      {t`New chat`}
    </Button>
  );
  return (
    <div data-slot="window-bar-preview" className="flex flex-col gap-4">
      <Frame label={t`Beside the sidebar`}>
        <WindowBar
          banner={false}
          leadWidth="sidebar"
          controls={<WindowControls onAction={noop} />}
          lead={sidebarButton}
          title={title}
          actions={actions}
        />
      </Frame>
      <Frame label={t`Beside the icon rail`}>
        <WindowBar
          banner={false}
          controls={<WindowControls onAction={noop} />}
          lead={toggle(false)}
          title={title}
          actions={actions}
        />
      </Frame>
      <Frame label={t`No sidebar`}>
        <WindowBar
          banner={false}
          controls={<WindowControls onAction={noop} />}
          title={<WindowTitle as="p" title={t`Set up Taalcut`} />}
        />
      </Frame>
      <Frame label={t`Window inactive`} inactive>
        <WindowBar
          banner={false}
          leadWidth="sidebar"
          controls={<WindowControls onAction={noop} />}
          lead={sidebarButton}
          title={title}
          actions={actions}
        />
      </Frame>
      <Frame label={t`Full screen`}>
        <WindowBar fullScreen controls={<WindowControls onAction={noop} />} title={title} actions={actions} />
      </Frame>
      <Frame label={t`No window behind the page (inert)`}>
        <WindowBar
          banner={false}
          leadWidth="sidebar"
          controls={<WindowControls />}
          lead={sidebarButton}
          title={<WindowTitle as="p" title={t`Library`} />}
        />
      </Frame>
    </div>
  );
}
