// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: platform list · some of the platforms, in the order given, the visitor's own marked
 * mode: Persuade · system: WEB2 Remix Vernacular
 * states: default (the server HTML, and anyone whose computer we can't tell: a phone, a tablet) · yours (once the
 *   script reads the browser's platform, that block wears its "You're on…" sticker) · not a control
 * The order is the page's: the Mac, which has the download, comes first whatever the visitor's computer. */

import { useEffect, useState } from 'react';
import type { PlatformId } from '#content/schema';
import { detectPlatform } from './detect';
import { PlatformBlock } from './platform-block';

interface UAData {
  readonly platform?: string;
}

export function PlatformList({ ids }: { readonly ids: readonly PlatformId[] }) {
  const [yours, setYours] = useState<PlatformId | null>(null);

  useEffect(() => {
    const data = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
    setYours(
      detectPlatform({
        uaPlatform: data?.platform,
        userAgent: navigator.userAgent,
        touchPoints: navigator.maxTouchPoints,
      }),
    );
  }, []);

  return (
    <div className="flex flex-col gap-y-[clamp(6rem,8vw+2rem,10rem)]" data-yours={yours ?? undefined}>
      {ids.map((id) => (
        <div key={id} className="group/platform">
          <PlatformBlock id={id} yours={id === yours} />
        </div>
      ))}
    </div>
  );
}
