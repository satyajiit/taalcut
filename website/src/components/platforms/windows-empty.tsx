// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: Windows' empty window · Taalcut for Windows drawn as an outline: the window it will be, empty for now
 * mode: Persuade · system: WEB2 Remix Vernacular (an empty state that says where things stand; Kaatu naps on its
 *   edge)
 * states: the window is a drawing (aria-hidden bar and controls); its words read. Nothing here is a control: there
 *   is no Windows version to ask for. Kaatu: decorative, a still nap under reduced motion. */

import { Minus, Square, X } from 'lucide-react';
import { BrandIcon } from '#components/brand/brand-icon';
import { Kaatu } from '#components/kaatu/kaatu';
import { PLATFORMS_PAGE } from '#content/platforms';
import { ICON_STROKE } from '#lib/icons';

const P = PLATFORMS_PAGE.platforms.windows;
const APP = PLATFORMS_PAGE.app;

export function WindowsEmpty() {
  return (
    <div
      data-slot="empty-window"
      className="relative rounded-window border-2 border-dashed border-rule-strong"
    >
      <div
        aria-hidden
        data-slot="icon-text"
        className="flex h-12 items-center gap-2.5 border-b-2 border-dashed border-rule px-4"
      >
        <BrandIcon id="windows" className="size-4" />
        <span className="flex-1 truncate type-label text-ink-2">{P.window}</span>
        <span className="flex items-center gap-4 text-ink-3">
          <Minus strokeWidth={ICON_STROKE} className="size-4" />
          <Square strokeWidth={ICON_STROKE} className="size-3.5" />
          <X strokeWidth={ICON_STROKE} className="size-4" />
        </span>
      </div>
      <div className="flex flex-col items-center gap-3 px-6 pt-12 pb-14 text-center">
        <div data-slot="icon-text" className="flex flex-col items-center gap-5">
          <BrandIcon id="windows" className="size-14 opacity-90" />
          <p className="m-0 type-site-subhead text-ink">{APP.empty}</p>
        </div>
        <p className="m-0 max-w-[26em] type-site-body text-ink-2">{APP.emptyLine}</p>
      </div>
      <Kaatu pose="nap" size={96} sticker interactive className="absolute -end-3 -bottom-8" />
    </div>
  );
}
