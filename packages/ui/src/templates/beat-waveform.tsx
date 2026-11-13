// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: beat waveform · genre: atmospheric studio app · system: DESIGN.md v0.3 (rose is rhythm)
 * the reference's sound as a mirrored peak envelope in the beat's soft tone; the slot under the pointer or the
 *   selected one in the beat's strong tone; beats as rose ticks beneath, downbeats taller; slot cuts as hairlines
 * states: n/a (a picture, not a control: the slot strip under it takes the pointer and the keyboard)
 * colours are read from the tokens at draw time and redrawn when the theme changes (DESIGN.md rule 4)
 */
import type { Template } from '@taalcut/core';
import { useEffect, useRef, useState } from 'react';
import { cn } from '#lib/cn';
import { toSeconds } from './slot-words';
import { reelWaveform } from './waveform-shape';

export interface BeatWaveformProps {
  template: Template;
  /** Seconds to light up in the strong tone: the slot under the pointer, else the selected one. */
  highlight?: { readonly start: number; readonly end: number } | null;
  className?: string;
}

/** Tokens the drawing uses; read from CSS each time, never chosen in JavaScript per theme. */
const TOKENS = ['--color-beat', '--color-beat-strong', '--color-rule-strong'] as const;

function readTokens(element: Element): Record<(typeof TOKENS)[number], string> {
  const style = getComputedStyle(element);
  return Object.fromEntries(TOKENS.map((name) => [name, style.getPropertyValue(name).trim()])) as Record<
    (typeof TOKENS)[number],
    string
  >;
}

/** A redraw counter that moves when the page's theme does (the html attribute or the system appearance). */
function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => requestAnimationFrame(() => setTick((n) => n + 1));
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', bump);
    return () => {
      observer.disconnect();
      media?.removeEventListener?.('change', bump);
    };
  }, []);
  return tick;
}

export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  template: Template,
  width: number,
  height: number,
  colours: Record<(typeof TOKENS)[number], string>,
  highlight: BeatWaveformProps['highlight'],
): void {
  const total = toSeconds(template.duration) || 1;
  // A waveform flattened before REF1 draws as none: no flat band, the cuts and the beats only.
  const peaks = reelWaveform(template);
  const ticks = 10;
  const body = height - ticks;
  const mid = body / 2;
  ctx.clearRect(0, 0, width, height);
  if (peaks) {
    const perSecond = peaks.rate.num / peaks.rate.den;
    for (let x = 0; x < width; x += 2) {
      const from = Math.floor((x / width) * total * perSecond);
      const to = Math.max(from + 1, Math.floor(((x + 2) / width) * total * perSecond));
      let peak = 0;
      for (let i = from; i < to && i < peaks.peaks.length; i += 1) peak = Math.max(peak, peaks.peaks[i]!);
      const seconds = (x / width) * total;
      const lit = highlight && seconds >= highlight.start && seconds < highlight.end;
      // The sound outside the lit slot in the beat's mid tone (about 3:1 on the sunken bed; the soft tone
      // vanished there in light, BRK1-REV), the lit slot's in its strong tone.
      ctx.fillStyle = lit ? colours['--color-beat-strong'] : colours['--color-beat'];
      const h = Math.max(1, peak * (body - 2));
      ctx.fillRect(x, mid - h / 2, 1.5, h);
    }
  }
  // Slot cuts: hairlines through the sound.
  ctx.fillStyle = colours['--color-rule-strong'];
  for (const slot of template.slots.slice(1)) {
    ctx.fillRect(Math.round((toSeconds(slot.start) / total) * width), 0, 1, body);
  }
  // Beats beneath, downbeats taller.
  const map = template.beatMap;
  if (map) {
    const downbeats = new Set(map.downbeats);
    ctx.fillStyle = colours['--color-beat-strong'];
    map.beats.forEach((beat, index) => {
      const x = Math.round((toSeconds(beat) / total) * width);
      const tall = downbeats.has(index);
      ctx.fillRect(x, height - (tall ? ticks : ticks / 2), 1.5, tall ? ticks : ticks / 2);
    });
  }
}

/**
 * The reference's sound over time, on a canvas the width of the slot strip
 * below it, so a slot and its stretch of sound line up. Device pixels, so it
 * stays sharp on Retina displays.
 */
export function BeatWaveform({ template, highlight = null, className }: BeatWaveformProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const theme = useThemeTick();

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx || size.width === 0) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = Math.round(size.width * ratio);
    element.height = Math.round(size.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawWaveform(ctx, template, size.width, size.height, readTokens(element), highlight);
  }, [template, size, highlight, theme]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      data-slot="beat-waveform"
      data-waveform={reelWaveform(template) ? 'shaped' : 'none'}
      className={cn('block h-14 w-full', className)}
    />
  );
}
