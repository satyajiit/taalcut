// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · component: effect pictures (UX4, B14) · Operate · system: DESIGN.md v0.7 (the viewer grey, the beat's
 *   rose, the motion grammar)
 * A small drawn frame for each named effect, so the Effects picker shows what an effect does instead of naming it in
 *   an editor's words: a 9:16 frame on the viewer grey (footage, the same in both themes), a quiet scene in it, and
 *   the part the effect adds in the viewer's ink. What lands on the beat is rose (rhythm's colour). On the tile's
 *   hover or keyboard focus the added part moves the way the effect does, once, and settles back when you leave:
 *   a preview that answers a hand, never a loop on a still screen.
 * states: rest · previewing (the tile hovered or focused: transform only, --dur-short) · reduced motion: still
 * Decorative: the tile's words name the effect; the picture is aria-hidden. */
import type { ChatEffectId } from '@taalcut/core';
import type { ReactNode } from 'react';
import { cn } from '#lib/cn';

/** The preview's motion: on the tile's hover or focus-visible, transform only, back when you leave. */
const MOVE =
  'transition-transform duration-(--dur-short) ease-(--ease-out) [transform-box:fill-box] motion-reduce:transition-none';
const ON =
  'group-hover/tile:[transform:var(--to)] group-focus-visible/tile:[transform:var(--to)] motion-reduce:[transform:none]!';

const ink = 'fill-viewer-ink';
const soft = cn('fill-viewer-ink-2 opacity-40');
/** What lands on the beat: rhythm's colour (DESIGN.md, the beat's rose). */
const beat = 'fill-beat';

/** Something the effect adds, that moves to `to` (a CSS transform) while the tile is previewed. */
function Part({ to, origin = 'center', children }: { to: string; origin?: string; children: ReactNode }) {
  return (
    <g className={cn(MOVE, ON)} style={{ ['--to' as string]: to, transformOrigin: origin }}>
      {children}
    </g>
  );
}

const Bar = ({
  x,
  y,
  w,
  h = 3,
  className = ink,
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  className?: string;
}) => <rect x={x} y={y} width={w} height={h} rx={h / 2} className={className} />;

/** The footage: a horizon and a low sun, quiet, so the effect's part reads over it. */
const Scene = () => (
  <>
    <rect x="2" y="38" width="32" height="24" className={soft} />
    <circle cx="24" cy="30" r="5" className={soft} />
  </>
);

const PICTURES: Readonly<Record<ChatEffectId, () => ReactNode>> = {
  kineticTitle: () => (
    <>
      <Scene />
      <Part to="translateY(-3px)">
        <Bar x={8} y={12} w={20} />
        <Bar x={11} y={18} w={14} />
      </Part>
    </>
  ),
  blurResolve: () => (
    <>
      <Scene />
      <Part to="scale(1.12)">
        <Bar x={7} y={14} w={22} h={5} className="fill-viewer-ink opacity-60" />
      </Part>
    </>
  ),
  maskReveal: () => (
    <>
      <Scene />
      <Part to="scaleX(0.55)" origin="left">
        <Bar x={7} y={14} w={22} h={4} />
      </Part>
    </>
  ),
  oversizeDrop: () => (
    <>
      <Scene />
      <Part to="translateY(4px)">
        <Bar x={4} y={10} w={28} h={7} />
      </Part>
    </>
  ),
  flipReveal: () => (
    <>
      <Scene />
      <Part to="scaleY(0.3)">
        <rect x="8" y="12" width="5" height="7" rx="1" className={ink} />
        <rect x="15.5" y="12" width="5" height="7" rx="1" className={ink} />
        <rect x="23" y="12" width="5" height="7" rx="1" className={ink} />
      </Part>
    </>
  ),
  wordSwap: () => (
    <>
      <Scene />
      <Bar x={8} y={14} w={9} />
      <Part to="translateY(-4px)">
        <Bar x={19} y={14} w={9} className={beat} />
      </Part>
    </>
  ),
  staccatoHit: () => (
    <>
      <Scene />
      <Part to="scale(1.25)">
        <Bar x={9} y={13} w={18} h={5} />
      </Part>
      <Bar x={6} y={58} w={2} h={3} className={beat} />
      <Bar x={14} y={58} w={2} h={3} className={beat} />
      <Bar x={22} y={58} w={2} h={3} className={beat} />
      <Bar x={30} y={58} w={2} h={3} className={beat} />
    </>
  ),
  lowerThird: () => (
    <>
      <Scene />
      <Part to="translateX(-5px)">
        <rect x="6" y="44" width="20" height="8" rx="2" className={ink} />
      </Part>
    </>
  ),
  callout: () => (
    <>
      <Scene />
      <Part to="scale(1.2)">
        <circle cx="24" cy="30" r="8" fill="none" strokeWidth="1.5" className="stroke-viewer-ink" />
      </Part>
    </>
  ),
  animatedList: () => (
    <>
      <Scene />
      <Part to="translateX(3px)">
        <Bar x={7} y={11} w={3} className={ink} />
        <Bar x={12} y={11} w={16} />
        <Bar x={7} y={17} w={3} className={ink} />
        <Bar x={12} y={17} w={12} />
        <Bar x={7} y={23} w={3} className={ink} />
        <Bar x={12} y={23} w={14} />
      </Part>
    </>
  ),
  counter: () => (
    <>
      <Scene />
      <Part to="scale(1.15)">
        <rect
          x="9"
          y="11"
          width="6"
          height="10"
          rx="2"
          fill="none"
          strokeWidth="2"
          className="stroke-viewer-ink"
        />
        <rect
          x="18"
          y="11"
          width="6"
          height="10"
          rx="2"
          fill="none"
          strokeWidth="2"
          className="stroke-viewer-ink"
        />
      </Part>
    </>
  ),
  barChart: () => (
    <>
      <Part to="scaleY(1.3)" origin="bottom">
        <rect x="8" y="34" width="5" height="20" rx="1" className={ink} />
        <rect x="16" y="26" width="5" height="28" rx="1" className={ink} />
        <rect x="24" y="40" width="5" height="14" rx="1" className={ink} />
      </Part>
    </>
  ),
  callToAction: () => (
    <>
      <Scene />
      <Part to="translateY(-4px)">
        <rect x="7" y="46" width="22" height="9" rx="4.5" className={ink} />
      </Part>
    </>
  ),
  lockedOn: () => (
    <>
      <Part to="translateX(3px)">
        <circle cx="18" cy="26" r="6" className={soft} />
        <path
          d="M9 19v-3h3M27 19v-3h-3M9 33v3h3M27 33v3h-3"
          fill="none"
          strokeWidth="1.5"
          className="stroke-viewer-ink"
        />
      </Part>
    </>
  ),
  punchIn: () => (
    <>
      <Scene />
      <Part to="scale(1.35)">
        <rect
          x="9"
          y="18"
          width="18"
          height="28"
          rx="2"
          fill="none"
          strokeWidth="1.5"
          className="stroke-viewer-ink"
        />
      </Part>
    </>
  ),
  zoomThrough: () => (
    <>
      <rect
        x="6"
        y="12"
        width="24"
        height="40"
        rx="2"
        fill="none"
        strokeWidth="1.5"
        className="stroke-viewer-ink-2"
      />
      <Part to="scale(1.6)">
        <rect
          x="12"
          y="22"
          width="12"
          height="20"
          rx="2"
          fill="none"
          strokeWidth="1.5"
          className="stroke-viewer-ink"
        />
      </Part>
    </>
  ),
  blurBackdrop: () => (
    <>
      <rect x="2" y="2" width="32" height="60" className="fill-viewer-ink-2 opacity-20" />
      <Part to="scale(1.06)">
        <rect x="2" y="23" width="32" height="18" className={ink} opacity="0.75" />
      </Part>
    </>
  ),
  kenBurns: () => (
    <Part to="translate(-3px, -2px) scale(1.12)">
      <Scene />
    </Part>
  ),
  oneTakeFlow: () => (
    <>
      <Part to="translateX(-6px)">
        <rect x="4" y="18" width="16" height="28" rx="2" className={soft} />
        <rect x="22" y="18" width="16" height="28" rx="2" className="fill-viewer-ink-2 opacity-60" />
      </Part>
    </>
  ),
  rhythmContrast: () => (
    <>
      <Scene />
      <Part to="scaleX(1.15)" origin="left">
        <Bar x={4} y={56} w={3} h={4} className={beat} />
        <Bar x={9} y={56} w={3} h={4} className={beat} />
        <Bar x={14} y={56} w={3} h={4} className={beat} />
        <Bar x={21} y={56} w={11} h={4} className={ink} />
      </Part>
    </>
  ),
  whipPan: () => (
    <>
      <Part to="translateX(-5px)">
        <Bar x={6} y={22} w={24} h={2} />
        <Bar x={10} y={30} w={22} h={2} />
        <Bar x={4} y={38} w={20} h={2} />
      </Part>
    </>
  ),
  flashCut: () => (
    <>
      <Scene />
      <Part to="scale(1.2)">
        <rect x="8" y="16" width="20" height="30" rx="3" className="fill-viewer-ink opacity-70" />
      </Part>
      <Bar x={16} y={56} w={4} h={4} className={beat} />
    </>
  ),
  zoomCut: () => (
    <>
      <rect x="4" y="16" width="13" height="30" rx="2" className={soft} />
      <Part to="scale(1.2)">
        <rect x="20" y="20" width="12" height="22" rx="2" className="fill-viewer-ink-2 opacity-70" />
      </Part>
    </>
  ),
  slideFlow: () => (
    <Part to="translateX(-8px)">
      <rect x="4" y="18" width="14" height="28" rx="2" className={soft} />
      <rect x="20" y="18" width="14" height="28" rx="2" className="fill-viewer-ink-2 opacity-60" />
      <path d="M14 32h10m-3-3 3 3-3 3" fill="none" strokeWidth="1.5" className="stroke-viewer-ink" />
    </Part>
  ),
  popCaptions: () => (
    <>
      <Scene />
      <Bar x={7} y={47} w={7} h={4} className={ink} />
      <Part to="scale(1.25)">
        <Bar x={16} y={47} w={13} h={4} className={beat} />
      </Part>
    </>
  ),
  boxCaptions: () => (
    <>
      <Scene />
      <Part to="scale(1.1)">
        <rect x="5" y="44" width="26" height="9" rx="2" className={ink} />
      </Part>
    </>
  ),
  cutHits: () => (
    <>
      <rect x="4" y="18" width="13" height="26" rx="2" className={soft} />
      <rect x="19" y="18" width="13" height="26" rx="2" className={soft} />
      <Part to="scaleY(1.6)" origin="bottom">
        <Bar x={6} y={54} w={2} h={4} className={ink} />
        <Bar x={10} y={52} w={2} h={6} className={ink} />
        <Bar x={17} y={48} w={2} h={10} className={beat} />
        <Bar x={24} y={53} w={2} h={5} className={ink} />
        <Bar x={28} y={55} w={2} h={3} className={ink} />
      </Part>
    </>
  ),
};

/** The effect, drawn: a 9:16 frame on the viewer grey with what the effect adds. */
export function EffectPicture({ effectId, className }: { effectId: ChatEffectId; className?: string }) {
  const Picture = PICTURES[effectId];
  return (
    <svg
      aria-hidden
      viewBox="0 0 36 64"
      data-slot="effect-picture"
      className={cn('h-16 w-9 shrink-0 overflow-hidden rounded-md', className)}
    >
      <rect x="0" y="0" width="36" height="64" rx="5" className="fill-viewer" />
      <svg x="0" y="0" width="36" height="64" overflow="hidden">
        <Picture />
      </svg>
    </svg>
  );
}
