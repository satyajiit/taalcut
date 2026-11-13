// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: platform list · the three platforms, the visitor's first
 * mode: Persuade · system: WEB2 Remix Vernacular
 * states: default order (the server HTML, and anyone whose computer we can't tell: a phone, a tablet) · yours first
 *   (once the script reads the browser's platform, that block slides to the top on a shared-layout spring and wears
 *   its "You're on…" sticker; under reduced motion it moves without sliding) · not a control */

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import type { PlatformId } from '#content/schema';
import { FLIGHT } from '#lib/motion';
import { detectPlatform, orderFor } from './detect';
import { PlatformBlock } from './platform-block';

interface UAData {
  readonly platform?: string;
}

export function PlatformList() {
  const [yours, setYours] = useState<PlatformId | null>(null);
  const reduce = useReducedMotionPref();

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
    <div className="flex flex-col gap-y-[clamp(6rem,8vw+2rem,10rem)]" data-order={orderFor(yours).join(' ')}>
      {orderFor(yours).map((id) => (
        <motion.div
          key={id}
          layout={reduce ? false : 'position'}
          transition={FLIGHT}
          className="group/platform"
        >
          <PlatformBlock id={id} yours={id === yours} />
        </motion.div>
      ))}
    </div>
  );
}
