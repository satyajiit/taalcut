// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the launch video's fact scenes · mode: Persuade · system: WEB2 Remix Vernacular
 * for Product launch videos, one small scene per fact, acted out once on arrival and again under the pointer
 *   (vignette.tsx): the sources docking beside the brief (taalcut.app, a project folder, a clip from the library, a
 *   voice recording); a page's screenshot taken and the project's app running in an isolated copy, its pointer
 *   moving; up to twelve scenes filling in, then the one approval; one video in four formats, with its voiceover
 * states: start · end (the server's and reduced motion's) · replay. Decorative, aria-hidden: the fact says it. */

import { Check, Folder, Globe, Mic, MicOff, MousePointer2 } from 'lucide-react';
import { Logo } from '#components/brand/logo';
import { cn } from '#lib/cn';
import { ClipFrame } from '../frame';
import { frameOf } from '../frames';
import { act, beat, motion, pop, type Scene, SceneChip, VignetteFrame } from '../vignette';

/** Sources: four of them pop in beside the brief, one after another. */
export function SourcesScene(scene: Scene) {
  const { reduce } = scene;
  const chips = [
    { key: 'site', node: <Globe />, word: 'taalcut.app' },
    { key: 'folder', node: <Folder />, word: 'website' },
    { key: 'clip', node: <ClipFrame sprite={frameOf('repeat-03')} className="w-3 rounded-[2px]" />, word: 'Karst field' },
    { key: 'voice', node: <Mic />, word: 'Your voice' },
  ];
  return (
    <VignetteFrame>
      <span className="absolute inset-y-4 left-4 flex w-[38%] flex-col gap-1.5 rounded-xl bg-raised p-2.5 shadow-sticker">
        <span className="text-[0.6875rem] font-semibold text-violet-strong">Product launch</span>
        {['w-full', 'w-11/12', 'w-3/4', 'w-5/6'].map((w) => (
          <span key={w} className={cn('h-1.5 rounded-pill bg-rule-subtle', w)} />
        ))}
      </span>
      <span className="absolute inset-y-3 right-4 left-[calc(38%+1.75rem)] flex flex-col justify-center gap-1.5">
        {chips.map((c, i) => (
          <motion.span
            key={c.key}
            className="w-fit"
            {...act(scene, { opacity: 0, x: 36, rotate: 6 }, { opacity: 1, x: 0, rotate: 0 }, pop(0.15 + i * 0.22, reduce))}
          >
            <SceneChip className="text-[0.75rem]">
              {c.node}
              {c.word}
            </SceneChip>
          </motion.span>
        ))}
      </span>
    </VignetteFrame>
  );
}

/** It captures: a page's screenshot flashes and its corners snap on; the app in its isolated copy, the pointer moving. */
export function CaptureScene(scene: Scene) {
  const { reduce } = scene;
  const corners = ['top-0 left-0 border-t-2 border-l-2', 'top-0 right-0 border-t-2 border-r-2', 'bottom-0 left-0 border-b-2 border-l-2', 'right-0 bottom-0 border-r-2 border-b-2'];
  return (
    <VignetteFrame>
      <span className="absolute top-4 left-4 w-[44%]">
        <span className="relative block aspect-[16/10] overflow-hidden rounded-md border border-rule bg-canvas p-1.5">
          <span className="flex items-center gap-1">
            <Logo kind="symbol" className="size-2.5" />
            <span className="h-1 w-8 rounded-pill bg-rule" />
          </span>
          <span className="mt-1.5 block h-2 w-4/5 rounded-pill bg-ink" />
          <span className="mt-1 block h-2 w-3/5 rounded-pill bg-ink" />
          <span className="mt-2 block h-2.5 w-10 rounded-pill bg-marigold" />
          {scene.ran ? (
            <motion.span
              className="absolute inset-0 bg-raised"
              {...act(scene, { opacity: 0 }, { opacity: [0, 0.9, 0] }, reduce ? { duration: 0.15 } : { delay: 0.35, duration: 0.45, times: [0, 0.2, 1] })}
            />
          ) : null}
        </span>
        {corners.map((c, i) => (
          <motion.span
            key={c}
            className={cn('absolute size-2.5 border-violet-strong', c)}
            {...act(scene, { scale: 1.8, opacity: 0 }, { scale: 1, opacity: 1 }, pop(0.2 + i * 0.04, reduce))}
          />
        ))}
      </span>
      <span className="absolute top-4 right-4 w-[40%]">
        <span className="relative block aspect-[16/10] rounded-md border-[1.5px] border-dashed border-violet-strong bg-violet-soft/40 p-1.5">
          <span className="block h-1.5 w-1/2 rounded-pill bg-violet-strong/50" />
          <span className="mt-1.5 grid grid-cols-3 gap-1">
            {[0, 1, 2].map((k) => (
              <span key={k} className="aspect-square rounded-sm bg-raised" />
            ))}
          </span>
          <motion.span
            className="absolute top-1/2 left-1/3 text-ink"
            {...act(scene, { x: -14, y: 10 }, { x: 22, y: -2 }, beat(0.7, reduce, 0.9))}
          >
            <MousePointer2 className="size-4 fill-raised" />
          </motion.span>
        </span>
      </span>
      <motion.span className="absolute bottom-3 left-4" {...act(scene, { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, beat(0.6, reduce, 0.4))}>
        <SceneChip className="text-[0.75rem]">Screenshot</SceneChip>
      </motion.span>
      <motion.span className="absolute right-4 bottom-3" {...act(scene, { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, beat(1.1, reduce, 0.4))}>
        <SceneChip className="text-[0.75rem]">Isolated copy</SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}

const FIELDS = ['bg-sticker-violet', 'bg-sticker-pink', 'bg-sticker-teal', 'bg-sticker-sky', 'bg-sticker-lime', 'bg-sticker-marigold'];

/** You approve: up to twelve scenes fill in, then the one approval pops on. */
export function ApproveScene(scene: Scene) {
  const { reduce } = scene;
  return (
    <VignetteFrame>
      <span className="absolute top-4 left-4 grid w-[54%] grid-cols-6 gap-1">
        {Array.from({ length: 12 }, (_, i) => (
          <motion.span
            key={i}
            className={cn('aspect-video rounded-[3px]', FIELDS[i % FIELDS.length])}
            {...act(scene, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1 }, pop(0.1 + i * 0.06, reduce))}
          />
        ))}
      </span>
      <motion.span className="absolute top-[3.6rem] left-4" {...act(scene, { opacity: 0, y: 6 }, { opacity: 1, y: 0 }, beat(0.9, reduce, 0.4))}>
        <SceneChip className="text-[0.75rem]">Script · up to 12 scenes</SceneChip>
      </motion.span>
      <motion.span
        className="absolute right-4 bottom-4"
        {...act(scene, { opacity: 0, scale: 0.6, rotate: -8 }, { opacity: 1, scale: 1, rotate: -3 }, pop(1.25, reduce))}
      >
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-inverse px-3 py-1.5 text-[0.8125rem] font-semibold whitespace-nowrap text-on-inverse shadow-sticker">
          <Check className="size-3.5" strokeWidth={3} />
          Approve script & design
        </span>
      </motion.span>
    </VignetteFrame>
  );
}

/** Formats: one video in four shapes, then how it is voiced. */
export function FormatScene(scene: Scene) {
  const { reduce } = scene;
  const shapes = [
    { key: '16:9', box: 'aspect-video w-16', field: 'bg-sticker-violet', ink: 'bg-sticker-violet-ink' },
    { key: '9:16', box: 'aspect-[9/16] h-14', field: 'bg-sticker-pink', ink: 'bg-sticker-pink-ink' },
    { key: '1:1', box: 'aspect-square h-11', field: 'bg-sticker-teal', ink: 'bg-sticker-teal-ink' },
    { key: '4:5', box: 'aspect-[4/5] h-12', field: 'bg-sticker-sky', ink: 'bg-sticker-sky-ink' },
  ];
  const voices = [
    { key: 'gen', icon: <Mic />, word: 'Generated' },
    { key: 'own', icon: <Mic />, word: 'Yours' },
    { key: 'none', icon: <MicOff />, word: 'None' },
  ];
  return (
    <VignetteFrame>
      <span className="absolute inset-x-4 top-3 flex h-16 items-end justify-between">
        {shapes.map((s, i) => (
          <motion.span
            key={s.key}
            className="flex flex-col items-center gap-1"
            {...act(scene, { opacity: 0, y: 14 }, { opacity: 1, y: 0 }, pop(0.12 + i * 0.18, reduce))}
          >
            <span className={cn('flex flex-col justify-end gap-0.5 rounded-[4px] p-1 shadow-sticker', s.box, s.field)}>
              <span className={cn('h-1 w-3/4 rounded-pill opacity-70', s.ink)} />
              <span className={cn('h-1 w-1/2 rounded-pill opacity-70', s.ink)} />
            </span>
          </motion.span>
        ))}
      </span>
      <span className="absolute inset-x-4 top-[4.9rem] flex justify-between text-[0.6875rem] font-semibold text-ink-2">
        {shapes.map((s) => (
          <span key={s.key} className="w-16 text-center tabular-nums">
            {s.key}
          </span>
        ))}
      </span>
      <span className="absolute inset-x-4 bottom-2.5 flex justify-center gap-1.5">
        {voices.map((v, i) => (
          <motion.span key={v.key} {...act(scene, { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, beat(0.9 + i * 0.15, reduce, 0.35))}>
            <SceneChip className="px-2 text-[0.6875rem]">
              {v.icon}
              {v.word}
            </SceneChip>
          </motion.span>
        ))}
      </span>
    </VignetteFrame>
  );
}
