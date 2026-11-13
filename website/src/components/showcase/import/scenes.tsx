// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: bringing footage in, its vignettes · mode: Persuade · system: WEB2 Remix Vernacular (teal is yours)
 * one small scene per fact, acted out once on arrival and again under the pointer (vignette.tsx): the phone scans the
 *   computer's code, both show the same match code, and its clips land on the computer; a watched folder takes a new
 *   clip as it lands; a card hands its clips over, DJI and Insta360 among them; Apple Photos gives up its originals,
 *   with iCloud's when you ask
 * states: start · end (the server's and reduced motion's) · replay. Decorative, aria-hidden: the fact says it. */

import { Check, CloudDownload, Eye, FolderOpen, Laptop, Smartphone } from 'lucide-react';
import { cn } from '#lib/cn';
import { EYES, QR_SIZE, qrModules } from '../auto-pick/qr-pattern';
import { ClipFrame } from '../frame';
import { frameOf } from '../frames';
import { act, beat, motion, pop, type Scene, SceneChip, VignetteFrame } from '../vignette';
import { MATCH_CODE } from './ways';

/** A small drawn code, the same not-a-code the auto-pick page draws (qr-pattern.ts), on the computer's screen. */
function TinyCode() {
  return (
    <svg viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`} className="size-full fill-current text-ink">
      {EYES.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 0.5} y={y + 0.5} width={6} height={6} rx={1.4} fill="none" stroke="currentColor" strokeWidth={1.2} />
      ))}
      {qrModules(5).map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x + 0.15} y={y + 0.15} width={0.7} height={0.7} />
      ))}
    </svg>
  );
}

/** From your phone: it scans the code, both show the same number, and its clips land on the computer. */
export function PhoneWayScene(scene: Scene) {
  const { reduce } = scene;
  const clips = ['repeat-04', 'repeat-06', 'repeat-15'];
  return (
    <VignetteFrame>
      <span className="absolute top-4 right-6 flex flex-col items-center gap-1">
        <span className="relative inline-grid size-16 place-items-center rounded-xl bg-raised p-2 shadow-sticker">
          <TinyCode />
        </span>
        <Laptop className="size-5 text-ink-2" />
      </span>
      <motion.span
        className="absolute top-5 left-8 inline-flex h-20 w-11 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-ink-2 bg-raised text-ink"
        {...act(scene, { x: 30, rotate: 8 }, { x: 0, rotate: -4 }, beat(0.1, reduce, 0.6))}
      >
        <Smartphone className="size-3 text-ink-3" />
        <span className="font-mono text-[0.8125rem] leading-none font-semibold tracking-[0.08em]">{MATCH_CODE}</span>
      </motion.span>
      <motion.span className="absolute top-3 right-24" {...act(scene, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1 }, pop(0.6, reduce))}>
        <SceneChip className="bg-teal-soft text-teal-strong shadow-none">
          <Check /> {MATCH_CODE}
        </SceneChip>
      </motion.span>
      <span className="absolute right-6 bottom-3 left-24 flex justify-end gap-1.5">
        {clips.map((id, i) => (
          <motion.span
            key={id}
            className="w-7"
            {...act(scene, { opacity: 0, x: -60, rotate: -10 }, { opacity: 1, x: 0, rotate: (i - 1) * 4 }, beat(0.9 + i * 0.18, reduce, 0.5))}
          >
            <ClipFrame sprite={frameOf(id)} className="w-full rounded-sm shadow-sticker" />
          </motion.span>
        ))}
      </span>
    </VignetteFrame>
  );
}

/** From your computer: a watched folder, and a new clip landing in it. */
export function FolderWayScene(scene: Scene) {
  const { reduce } = scene;
  const inside = ['vietnam-09', 'repeat-12', 'vietnam-11'];
  return (
    <VignetteFrame>
      <span className="absolute inset-x-6 bottom-3 flex h-20 items-end gap-2 rounded-xl border border-rule bg-sunken px-3 pb-2">
        <FolderOpen className="absolute -top-3 left-3 size-6 rounded-md bg-canvas p-0.5 text-teal-strong" />
        {inside.map((id) => (
          <span key={id} className="w-8">
            <ClipFrame sprite={frameOf(id)} className="w-full rounded-sm" />
          </span>
        ))}
        <motion.span
          className="relative w-8"
          {...act(scene, { opacity: 0, y: -70, rotate: -12 }, { opacity: 1, y: 0, rotate: 0 }, beat(0.75, reduce, 0.6))}
        >
          <ClipFrame sprite={frameOf('repeat-10')} className="w-full rounded-sm ring-2 ring-teal-strong" />
        </motion.span>
      </span>
      <motion.span className="absolute top-3 right-5" {...act(scene, { opacity: 0, scale: 0.5, rotate: 0 }, { opacity: 1, scale: 1, rotate: 3 }, pop(0.25, reduce))}>
        <SceneChip className="bg-teal-soft text-teal-strong shadow-none">
          <Eye /> Watching
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}

/** From a camera: a card hands its clips over; DJI and Insta360 among the cameras. */
export function CameraWayScene(scene: Scene) {
  const { reduce } = scene;
  const out = ['repeat-03', 'airport-05', 'vietnam-08'];
  const brands = [
    { word: 'DJI', at: 'top-3 right-24', r: -4 },
    { word: 'Insta360', at: 'top-3 right-4', r: 3 },
  ];
  return (
    <VignetteFrame>
      <svg viewBox="0 0 40 52" className="absolute bottom-4 left-6 h-20 w-auto text-ink-2">
        <path d="M4 2h24l10 10v36a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" className="fill-raised stroke-current" strokeWidth={2} />
        {[10, 16, 22].map((x) => (
          <rect key={x} x={x} y={6} width={3} height={8} rx={1} className="fill-current" />
        ))}
      </svg>
      <span className="absolute right-6 bottom-3 left-24 flex gap-1.5">
        {out.map((id, i) => (
          <motion.span
            key={id}
            className="w-8"
            {...act(scene, { opacity: 0, x: -50, scale: 0.7 }, { opacity: 1, x: 0, scale: 1 }, beat(0.3 + i * 0.2, reduce, 0.5))}
          >
            <ClipFrame sprite={frameOf(id)} className="w-full rounded-sm shadow-sticker" />
          </motion.span>
        ))}
      </span>
      {brands.map((b, i) => (
        <motion.span
          key={b.word}
          className={cn('absolute', b.at)}
          {...act(scene, { opacity: 0, scale: 0.5, rotate: 0 }, { opacity: 1, scale: 1, rotate: b.r }, pop(0.9 + i * 0.15, reduce))}
        >
          <SceneChip>{b.word}</SceneChip>
        </motion.span>
      ))}
    </VignetteFrame>
  );
}

/** From Apple Photos: originals ticked one by one, and iCloud's downloaded when you ask. */
export function PhotosWayScene(scene: Scene) {
  const { reduce } = scene;
  const grid = ['airport-06', 'vietnam-07', 'repeat-08', 'vietnam-10', 'airport-02', 'vietnam-04'];
  const picked = new Set(['vietnam-07', 'repeat-08', 'airport-02']);
  return (
    <VignetteFrame>
      <span className="absolute top-1/2 left-6 grid -translate-y-1/2 grid-cols-3 gap-1">
        {grid.map((id, i) => {
          const on = picked.has(id);
          return (
            <span key={id} className="relative w-7">
              <ClipFrame sprite={frameOf(id)} className={cn('w-full rounded-sm', on && 'ring-2 ring-teal-strong')} />
              {on ? (
                <motion.span
                  className="absolute -top-1.5 -right-1.5 inline-grid size-4 place-items-center rounded-pill bg-teal text-teal-ink"
                  {...act(scene, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1 }, pop(0.25 + i * 0.12, reduce))}
                >
                  <Check className="size-2.5" strokeWidth={3} />
                </motion.span>
              ) : null}
            </span>
          );
        })}
      </span>
      <motion.span className="absolute top-1/2 right-5 -mt-3" {...act(scene, { opacity: 0, scale: 0.5, rotate: 0 }, { opacity: 1, scale: 1, rotate: -3 }, pop(1.05, reduce))}>
        <SceneChip>
          <CloudDownload /> iCloud originals
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}
