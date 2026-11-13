// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: lost reel · mode: Recover (the 404's art) · system: WEB2 Remix Vernacular
 * states: the reel playing (on screen, tab shown) · paused (the reel's own Pause/Play control: default, hover, focus,
 *   active) · the broken bar: one segment knocked out of the template, its piece tumbling once from the gap (1.2 s, on
 *   load) to rest tilted past the frame's foot · stickers lean toward a mouse or trackpad pointer · Kaatu searches
 *   beside the frame, never on the footage · reduced motion (the reel never starts on its own; the piece already
 *   rests) · without JavaScript (the poster, the piece at rest)
 * "House full": the saved reel in its frame with its segment bar broken where this page should have been, the piece
 * on the floor, a sticker saying so, and Kaatu looking for the page. */

import { SearchX } from 'lucide-react';
import { motion, useAnimate } from 'motion/react';
import { useEffect } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { Kaatu } from '#components/kaatu/kaatu';
import { ReelFrame } from '#components/ui/reel-frame';
import { Sticker } from '#components/ui/sticker';
import { DEFAULT_REEL_ID, reelById } from '#content/reels';
import { cn } from '#lib/cn';

const SEGMENTS = 13;
const GAP = 6;

function BrokenBar() {
  return (
    <span aria-hidden className="flex gap-1">
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 flex-1 rounded-pill',
            i === GAP
              ? 'border border-dashed border-viewer-ink/80'
              : i < GAP
                ? 'bg-viewer-ink'
                : 'bg-viewer-ink/40',
          )}
        />
      ))}
    </span>
  );
}

/** The piece tumbles from the gap once, after load; the server HTML and reduced motion show it at rest. */
function FallenPiece() {
  const reduce = useReducedMotionPref();
  const [scope, animate] = useAnimate<HTMLSpanElement>();
  useEffect(() => {
    if (reduce || !scope.current) return;
    void animate(
      scope.current,
      { y: ['-28rem', '0rem'], rotate: [0, -14] },
      { type: 'spring', stiffness: 120, damping: 11, mass: 0.9, delay: 0.4 },
    );
  }, [animate, reduce, scope]);
  return (
    <motion.span
      ref={scope}
      aria-hidden
      style={{ rotate: -14 }}
      className="absolute -bottom-3 left-[38%] block h-2.5 w-[11%] rounded-pill bg-ink shadow-sticker"
    />
  );
}

export function LostReel() {
  const reel = reelById(DEFAULT_REEL_ID);
  return (
    <div className="relative mx-auto w-full max-w-[14rem] sm:max-w-[18rem]">
      {/* Kaatu peeks from behind the frame's left edge, never over the footage. */}
      <Kaatu
        pose="search"
        size={112}
        interactive
        sticker
        toward="left"
        className="absolute bottom-[14%] -left-16 -rotate-6 sm:-left-20"
      />
      <div className="relative z-10">
        <ReelFrame
          sources={reel.reference}
          poster={reel.poster}
          label={`A saved reel, ${reel.title}, with one segment missing from its bar`}
          bar={<BrokenBar />}
          control="bottom-left"
          stickers={
            <>
              <div className="absolute top-[18%] -right-[10%]">
                <Sticker field="pink" icon={SearchX} tilt={6} size="lg">
                  Page not found
                </Sticker>
              </div>
              <div className="absolute top-[30%] -left-[8%]">
                <Sticker field="lime" tilt={-5}>
                  404
                </Sticker>
              </div>
              {/* The piece that fell out of the bar, at rest past the frame's foot. */}
              <FallenPiece />
            </>
          }
        />
      </div>
    </div>
  );
}
