// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the making vignettes · mode: Persuade · system: WEB2 Remix Vernacular
 * for The editor you talk to and Fine-tune when you want:
 * one small scene per fact, acted out once on arrival and again under the pointer (vignette.tsx): your three steps
 *   ticking; the cut checked against the reel, cut by cut; the last change undone; how hard it thinks, chosen; a
 *   clip split and trimmed on the beat; captions said word by word, then the SRT file; a title the AI designed, its
 *   size changed; the export's files
 * states: start · end (the server's and reduced motion's) · replay. Decorative, aria-hidden: the fact says it. */

import { Captions, Check, CircleCheck, Folder, Link, Undo2, Upload } from 'lucide-react';
import { AiMark } from '#components/brand/ai-mark';
import { cn } from '#lib/cn';
import { ClipFrame } from './frame';
import { frameOf } from './frames';
import { act, beat, motion, pop, type Scene, SceneChip, VignetteFrame } from './vignette';
import { ICONS } from '#lib/icons';

/** You do: paste, point, approve, each ticked in turn. */
export function StepsScene(scene: Scene) {
  const { reduce } = scene;
  const steps = [
    { key: 'paste', icon: Link, word: 'Paste' },
    { key: 'point', icon: Folder, word: 'Point' },
    { key: 'approve', icon: Check, word: 'Approve' },
  ];
  return (
    <VignetteFrame>
      <div className="absolute inset-x-4 top-1/2 flex -translate-y-1/2 items-center justify-between">
        <span className="absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-rule" />
        <motion.span
          className="absolute inset-x-8 top-1/2 h-0.5 origin-left -translate-y-1/2 bg-violet"
          {...act(scene, { scaleX: 0 }, { scaleX: 1 }, beat(0.2, reduce, 1.2))}
        />
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <span key={s.key} className="relative flex flex-col items-center gap-1.5">
              <span className="relative inline-grid size-11 place-items-center rounded-2xl bg-raised text-ink-2 shadow-sticker">
                <Icon className="size-5" />
                <motion.span
                  className="absolute -top-1.5 -right-1.5 inline-grid size-5 place-items-center rounded-pill bg-violet text-violet-ink"
                  {...act(
                    scene,
                    { scale: 0, opacity: 0 },
                    { scale: 1, opacity: 1 },
                    pop(0.3 + i * 0.45, reduce),
                  )}
                >
                  <Check className="size-3" strokeWidth={3} />
                </motion.span>
              </span>
              <span className="text-[0.75rem] font-semibold text-ink-2">{s.word}</span>
            </span>
          );
        })}
      </div>
    </VignetteFrame>
  );
}

/** It checks: your cut under the reel's bar, a tick popping at every cut it checked. */
export function CheckScene(scene: Scene) {
  const { reduce } = scene;
  const parts = [0.22, 0.16, 0.26, 0.14, 0.22];
  return (
    <VignetteFrame>
      <div className="absolute inset-x-5 top-5 flex flex-col gap-2">
        <span className="flex gap-1">
          {parts.map((w, i) => (
            <span key={i} className="h-2.5 rounded-sm bg-rose-soft" style={{ flexGrow: w }} />
          ))}
        </span>
        <span className="flex gap-1">
          {parts.map((w, i) => (
            <span key={i} className="h-6 rounded-md bg-violet-soft" style={{ flexGrow: w }} />
          ))}
        </span>
        <span className="flex gap-1">
          {parts.map((w, i) => (
            <span key={i} className="flex justify-end" style={{ flexGrow: w }}>
              {i < parts.length - 1 ? (
                <motion.span
                  className="translate-x-[60%] text-success-strong"
                  {...act(
                    scene,
                    { scale: 0, opacity: 0 },
                    { scale: 1, opacity: 1 },
                    pop(0.25 + i * 0.28, reduce),
                  )}
                >
                  <CircleCheck className="size-4" />
                </motion.span>
              ) : null}
            </span>
          ))}
        </span>
      </div>
      <motion.span
        className="absolute right-4 bottom-3"
        {...act(scene, { opacity: 0, y: 8 }, { opacity: 1, y: 0 }, beat(1.4, reduce, 0.4))}
      >
        <SceneChip className="text-[0.75rem]">
          <AiMark className="size-3.5 text-violet-strong" /> Checked against the reel
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}

/** Undo: the agent's last change leaves the list, and Undo says so. */
export function UndoScene(scene: Scene) {
  const { reduce } = scene;
  const rows = ['Hook', 'Peak', 'Captions'];
  return (
    <VignetteFrame>
      <div className="absolute inset-x-5 top-4 flex flex-col gap-1.5">
        {rows.map((row, i) => {
          const last = i === rows.length - 1;
          const body = (
            <span className="flex h-6 items-center gap-2 rounded-md bg-raised px-2 text-[0.75rem] text-ink shadow-xs">
              <AiMark className="size-3 text-violet-strong" />
              <span className="font-semibold">{row}</span>
              <span className="h-1.5 flex-1 rounded-pill bg-rule-subtle" />
            </span>
          );
          // The row that leaves is gone in the end state (the server HTML): it renders only once a run starts.
          if (!last) return <span key={row}>{body}</span>;
          return scene.ran ? (
            <motion.span
              key={row}
              {...act(scene, { opacity: 1, x: 0 }, { opacity: 0, x: 60 }, beat(0.6, reduce, 0.45))}
            >
              {body}
            </motion.span>
          ) : null;
        })}
      </div>
      <motion.span
        className="absolute right-5 bottom-3"
        {...act(
          scene,
          { opacity: 0, scale: 0.6, rotate: 30 },
          { opacity: 1, scale: 1, rotate: 0 },
          pop(0.35, reduce),
        )}
      >
        <SceneChip>
          <Undo2 /> Undo
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}

/** Thinking: in the chat box, how hard it thinks glides from Low to High. */
export function ThinkScene(scene: Scene) {
  const { reduce } = scene;
  return (
    <VignetteFrame>
      <div className="absolute inset-x-5 top-1/2 flex -translate-y-1/2 flex-col gap-2 rounded-2xl border border-rule bg-canvas p-2.5">
        <span className="h-2 w-3/5 rounded-pill bg-rule-subtle" />
        <span className="flex items-center gap-2">
          <AiMark className="size-4 text-violet-strong" />
          <span className="relative flex rounded-pill bg-control p-0.5 text-[0.6875rem] font-semibold text-ink-2">
            {['Low', 'Medium', 'High'].map((w) => (
              <span key={w} className="relative z-10 inline-grid h-6 w-13 place-items-center">
                {w}
              </span>
            ))}
            <motion.span
              className="absolute top-0.5 left-0.5 h-6 w-13 rounded-pill border border-violet-strong bg-violet-soft"
              {...act(scene, { x: 0 }, { x: 104 }, beat(0.3, reduce, 0.7))}
            />
          </span>
        </span>
      </div>
    </VignetteFrame>
  );
}

/** Timeline: a clip is split where the scissors fall, and the next edge moves on to a beat. */
export function TimelineScene(scene: Scene) {
  const { reduce } = scene;
  const clips = [
    { id: 'repeat-07', grow: 3 },
    { id: 'vietnam-11', grow: 4 },
    { id: 'repeat-14', grow: 3 },
  ];
  return (
    <VignetteFrame>
      <div className="absolute inset-x-5 top-8 flex h-12 gap-0.5">
        {clips.map((c, i) => (
          <motion.span
            key={c.id}
            className="relative flex origin-left overflow-hidden rounded-md border-b-[3px] border-violet-strong"
            style={{ flexGrow: c.grow, flexBasis: 0 }}
            {...(i === 0 ? act(scene, { scaleX: 0.82 }, { scaleX: 1 }, beat(1, reduce, 0.4)) : {})}
          >
            {[0, 1, 2, 3].map((k) => (
              <ClipFrame key={k} sprite={frameOf(c.id)} className="h-full shrink-0 rounded-none" />
            ))}
          </motion.span>
        ))}
      </div>
      <span className="absolute inset-x-5 top-[5.5rem] flex justify-between">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={cn('w-px rounded-pill bg-rose', i % 4 === 0 ? 'h-2.5' : 'h-1.5')} />
        ))}
      </span>
      <motion.span
        className="absolute top-2 left-[55%] text-ink"
        {...act(
          scene,
          { y: -24, opacity: 0, rotate: -40 },
          { y: 0, opacity: 1, rotate: 0 },
          beat(0.2, reduce, 0.45),
        )}
      >
        <ICONS.trim className="size-5" />
      </motion.span>
      <motion.span
        className="absolute top-7 left-[calc(55%+0.55rem)] h-14 w-0.5 origin-top rounded-pill bg-ink"
        {...act(scene, { scaleY: 0 }, { scaleY: 1 }, beat(0.6, reduce, 0.3))}
      />
    </VignetteFrame>
  );
}

/** Captions: the words light up as they are said, then they leave as an SRT file. */
export function CaptionScene(scene: Scene) {
  const { reduce } = scene;
  const words = ['We', 'walked', 'the', 'whole', 'way'];
  return (
    <VignetteFrame tone="viewer">
      <span className="absolute inset-y-3 left-5 aspect-[9/16] overflow-hidden rounded-lg">
        <ClipFrame sprite={frameOf('vietnam-05')} className="size-full rounded-none" />
      </span>
      <span className="absolute top-5 right-5 left-24 flex flex-wrap gap-1 text-[0.875rem] font-semibold">
        {words.map((w, i) => (
          <span key={w} className="relative rounded-sm px-1 text-viewer-ink">
            {/* A word's light passes and goes out, except the last word's, which the end state keeps lit: the others
                render only once a run starts, so the server HTML holds no highlight at opacity 0. */}
            {i === words.length - 1 || scene.ran ? (
              <motion.span
                className="absolute inset-0 rounded-sm bg-viewer-rule"
                {...act(
                  scene,
                  { opacity: 0 },
                  i === words.length - 1 ? { opacity: 1 } : { opacity: [0, 1, 1, 0] },
                  reduce
                    ? { duration: 0.15 }
                    : { duration: 0.3, delay: 0.2 + i * 0.22, times: [0, 0.15, 0.7, 1] },
                )}
              />
            ) : null}
            <span className="relative">{w}</span>
          </span>
        ))}
      </span>
      <motion.span
        className="absolute right-5 bottom-3"
        {...act(scene, { opacity: 0, y: 12, rotate: 0 }, { opacity: 1, y: 0, rotate: -4 }, pop(1.4, reduce))}
      >
        <SceneChip>
          <Captions /> captions.srt
        </SceneChip>
      </motion.span>
    </VignetteFrame>
  );
}

/** Graphics: the title the AI designed grows as its Size value slides. */
export function GraphicScene(scene: Scene) {
  const { reduce } = scene;
  return (
    <VignetteFrame>
      <span className="absolute inset-y-3 left-5 aspect-[9/16] overflow-hidden rounded-lg bg-viewer">
        <ClipFrame sprite={frameOf('repeat-09')} className="size-full rounded-none" />
        {/* The title at the frame's own scale: drawn, so it shrinks with the frame like the picture under it. */}
        <motion.svg
          viewBox="0 0 48 18"
          className="absolute inset-x-1 top-3 w-[calc(100%-0.5rem)]"
          {...act(scene, { scale: 0.75 }, { scale: 1.1 }, beat(0.4, reduce, 0.8))}
        >
          <rect width="48" height="18" rx="2" className="fill-viewer" />
          <text x="24" y="7.6" textAnchor="middle" fontSize="6.2" className="fill-viewer-ink font-bold">
            Six days
          </text>
          <text x="24" y="14.6" textAnchor="middle" fontSize="6.2" className="fill-viewer-ink font-bold">
            in Vietnam
          </text>
        </motion.svg>
      </span>
      <span className="absolute top-5 right-5 left-26 flex flex-col gap-3">
        <SceneChip className="w-fit bg-violet-soft text-[0.75rem] text-violet-strong shadow-none">
          <AiMark className="size-3.5" /> Designed by the AI
        </SceneChip>
        <span className="relative h-1.5 rounded-pill bg-rule">
          <motion.span
            className="absolute inset-y-0 left-0 w-full origin-left rounded-pill bg-ink"
            {...act(scene, { scaleX: 0.25 }, { scaleX: 0.75 }, beat(0.4, reduce, 0.8))}
          />
          <span className="absolute inset-0">
            <motion.span
              className="absolute inset-0"
              {...act(scene, { x: '25%' }, { x: '75%' }, beat(0.4, reduce, 0.8))}
            >
              <span className="absolute top-1/2 left-0 size-4 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-ink bg-raised" />
            </motion.span>
          </span>
        </span>
        <span className="text-[0.75rem] font-semibold text-ink-2">Size</span>
      </span>
    </VignetteFrame>
  );
}

/** Export: the files the cut leaves as. */
export function ExportScene(scene: Scene) {
  const { reduce } = scene;
  const files = [
    { name: 'MP4', x: -84, r: -6, tone: 'bg-raised' },
    { name: 'OTIO', x: 0, r: 2, tone: 'bg-sticker-sky text-sticker-sky-ink' },
    { name: 'FCPXML', x: 92, r: 6, tone: 'bg-sticker-lime text-sticker-lime-ink' },
  ];
  return (
    <VignetteFrame>
      <span className="absolute bottom-3 left-1/2 inline-grid size-10 -translate-x-1/2 place-items-center rounded-2xl bg-raised text-ink shadow-sticker">
        <Upload className="size-5" />
      </span>
      <span className="absolute top-1/2 left-1/2">
        {files.map((f, i) => (
          <motion.span
            key={f.name}
            className="absolute -translate-x-1/2 -translate-y-full"
            {...act(
              scene,
              { x: 0, y: 40, opacity: 0, rotate: 0, scale: 0.6 },
              { x: f.x, y: -2, opacity: 1, rotate: f.r, scale: 1 },
              pop(0.15 + i * 0.14, reduce),
            )}
          >
            <SceneChip className={f.tone}>{f.name}</SceneChip>
          </motion.span>
        ))}
      </span>
    </VignetteFrame>
  );
}
