// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the More tab's drawn motifs (MORE1) · system: DESIGN.md v0.7
 * small drawings that show a choice instead of naming it: a speed as how closely its ticks sit (slow is sparse,
 *   fast is dense), a transition as what happens between one frame and the next. One 1.5 px stroke, round caps,
 *   the ink of whatever holds them (currentColor); decoration only, the card's or the tile's words name the choice
 * states: n/a (drawings) · motion: none
 */
import type { ReactNode } from 'react';
import type { TransitionChoice } from '../edit-ops';

const STROKE = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', fill: 'none' } as const;

/** Ticks across the box: more of them the faster it plays. Normal speed draws six. */
export function SpeedMotif({ speed, className }: { speed: number; className?: string }) {
  const count = Math.max(2, Math.round(6 + 2 * Math.log2(Math.max(0.125, speed))));
  const [width, height, inset] = [44, 16, 3];
  const gap = (width - inset * 2) / (count - 1);
  return (
    <svg
      aria-hidden
      data-slot="speed-motif"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
    >
      {Array.from({ length: count }, (_, index) => (
        <line
          key={index}
          {...STROKE}
          x1={inset + index * gap}
          x2={inset + index * gap}
          y1={3}
          y2={height - 3}
        />
      ))}
    </svg>
  );
}

/** The frame before the cut, on the left of every transition's drawing. */
const before = <rect {...STROKE} x={2} y={3} width={15} height={22} rx={2.5} />;
/** The frame after it. */
const after = <rect {...STROKE} x={27} y={3} width={15} height={22} rx={2.5} />;

const DRAWN: Readonly<Record<TransitionChoice, ReactNode>> = {
  // Two frames that meet at one line.
  cut: (
    <>
      <rect {...STROKE} x={5} y={3} width={16} height={22} rx={2.5} />
      <rect {...STROKE} x={23} y={3} width={16} height={22} rx={2.5} />
    </>
  ),
  // The two frames lie over each other for a moment.
  dissolve: (
    <>
      <rect {...STROKE} x={5} y={3} width={21} height={22} rx={2.5} />
      <rect {...STROKE} x={18} y={3} width={21} height={22} rx={2.5} />
      <rect x={18} y={3} width={8} height={22} fill="currentColor" opacity={0.3} />
    </>
  ),
  // Black between them.
  fade: (
    <>
      {before}
      {after}
      <rect x={19} y={5} width={6} height={18} rx={1.5} fill="currentColor" />
    </>
  ),
  // A burst of light between them.
  flash: (
    <>
      {before}
      {after}
      <path {...STROKE} d="M22 9v10M17.5 14h9M19 11l6 6M25 11l-6 6" />
    </>
  ),
  // The picture streaks sideways.
  whip: (
    <>
      {before}
      {after}
      <path {...STROKE} d="M19 9h6M18 14h8M19 19h6" />
    </>
  ),
  // The next frame grows out of the middle of this one.
  zoom: (
    <>
      <rect {...STROKE} x={8} y={2} width={28} height={24} rx={2.5} />
      <rect {...STROKE} x={15} y={8} width={14} height={12} rx={2} />
      <rect x={19.5} y={11.5} width={5} height={5} rx={1} fill="currentColor" />
    </>
  ),
  // The next frame comes in over this one from the side.
  slide: (
    <>
      <rect {...STROKE} x={4} y={3} width={18} height={22} rx={2.5} />
      <rect x={16} y={3} width={18} height={22} rx={2.5} fill="currentColor" opacity={0.3} />
      <rect {...STROKE} x={16} y={3} width={18} height={22} rx={2.5} />
      <path {...STROKE} d="M42 14h-5m2-2.5L36.5 14l2.5 2.5" />
    </>
  ),
};

/** What happens between this scene and the next, drawn. */
export function TransitionMotif({ kind, className }: { kind: TransitionChoice; className?: string }) {
  return (
    <svg
      aria-hidden
      data-slot="transition-motif"
      data-kind={kind}
      viewBox="0 0 44 28"
      width={44}
      height={28}
      className={className}
    >
      {DRAWN[kind]}
    </svg>
  );
}
