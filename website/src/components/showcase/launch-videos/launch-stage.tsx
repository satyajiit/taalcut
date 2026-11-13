// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the finished launch video, playing · mode: Operate · system: WEB2 Remix Vernacular
 * the showcase's lead: the launch video in every format the brief chose, side by side (format-frames.tsx); under it
 *   the video's scenes as the world's segment bar (violet: the AI made them), grouped Hook, Build, Peak and Outro and
 *   filled stories-style by the video's clock, with Pause/Play and the timecode; then production on one line
 *   (production-line.tsx). Open editor puts the video on the timeline in its place (editor-view.tsx)
 * states: being made (the bar fills scene by scene as production designs them; the frames show the scene in work) ·
 *   ready (it plays while half on screen, never on its own under reduced motion; the visitor's Pause or Play wins) ·
 *   paused · waiting for a new version's approval · in the editor · the control: default · hover · focus · active
 * motion: the frames cut on the scene's clock; the bar fills by transform; reduced motion: nothing plays until asked */

import { AnimatePresence, motion } from 'motion/react';
import { SegmentBar, type Segment } from '#components/ui/segment-bar';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { DUR, EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { EditorView } from './editor-view';
import { FormatFrames } from './format-frames';
import type { PassFrame } from './pass';
import { ProductionLine } from './production-line';
import { type Aspect, clock, type Scene, sceneSpans, type Voice } from './story';
import type { ScenePlayer } from './use-player';

/** The scenes as segments on the video's clock. */
export function sceneSegments(scenes: readonly Scene[]): Segment[] {
  return sceneSpans(scenes).map(([start, end], i) => ({ start, end, group: scenes[i]!.group }));
}

export function sceneBarLabel(scenes: readonly Scene[]): string {
  return `The video’s ${scenes.length} scenes, ${clock(sceneSpans(scenes).at(-1)?.[1] ?? 0)} in all`;
}

/** Pause/Play for the video, as a reel frame's: what pressing it does is its name. */
export function PlayControl({ player }: { readonly player: ScenePlayer }) {
  const Glyph = player.playing ? ICONS.pause : ICONS.play;
  return (
    <button
      type="button"
      onClick={player.toggle}
      data-slot="play-control"
      aria-label={player.playing ? 'Pause the video' : 'Play the video'}
      className="inline-grid size-9 shrink-0 place-items-center rounded-pill bg-inverse text-on-inverse transition-[background-color,transform] duration-(--dur-micro) ease-(--ease-out) hover:bg-inverse/85 active:scale-[0.96] motion-reduce:active:scale-100"
    >
      <Glyph aria-hidden strokeWidth={ICON_STROKE} className="size-4" fill="currentColor" />
    </button>
  );
}

export function SceneBar({ scenes, player, started }: { readonly scenes: readonly Scene[]; readonly player: ScenePlayer; readonly started: boolean }) {
  return (
    <div className="@container">
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <PlayControl player={player} />
      <div className="order-3 min-w-0 basis-full pb-1 @min-[30rem]:order-none @min-[30rem]:flex-1 @min-[30rem]:basis-0">
        <SegmentBar
          segments={sceneSegments(scenes)}
          time={started ? player.time : undefined}
          state={started ? 'playing' : 'filled'}
          layout="time"
          tone="surface"
          labels
          numbers
          label={sceneBarLabel(scenes)}
        />
      </div>
      <span className="ms-auto shrink-0 pb-1 type-timecode text-ink-2 @min-[30rem]:ms-0">
        {clock(player.second)} / {clock(player.total)}
      </span>
    </div>
    </div>
  );
}

export function LaunchStage({
  made,
  formats,
  voice,
  frame,
  approved,
  player,
  started,
  opened,
  onOpen,
  reduce,
}: {
  /** The scenes as production made them: the approved version (the script may have moved on). */
  readonly made: readonly Scene[];
  readonly formats: readonly Aspect[];
  readonly voice: Voice;
  readonly frame: PassFrame;
  readonly approved: boolean;
  readonly player: ScenePlayer;
  /** The bar follows the clock (a run or the player has started); before that it rests filled. */
  readonly started: boolean;
  readonly opened: boolean;
  readonly onOpen: (opened: boolean) => void;
  readonly reduce: boolean;
}) {
  const index = frame.ready ? player.scene : (frame.designing ?? Math.max(0, frame.designed - 1));
  const scene = made[index] ?? made[0]!;
  const fade = reduce ? { duration: REDUCED_FADE } : { duration: DUR.short, ease: EASE_OUT };
  return (
    <section ref={player.ref} aria-label="The launch video" data-slot="launch-stage" className="flex min-w-0 flex-col gap-4 rounded-xl bg-sunken p-4">
      <AnimatePresence mode="wait" initial={false}>
        {opened ? (
          <motion.div key="editor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade}>
            <EditorView scenes={made} voice={voice} aspect={formats[0] ?? '16:9'} onBack={() => onOpen(false)} />
          </motion.div>
        ) : (
          <motion.div key="video" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fade} className="flex flex-col gap-4">
            <div className={cn('transition-opacity duration-(--dur-short)', !approved && 'opacity-60')}>
              <FormatFrames
                formats={formats}
                scene={scene}
                index={index}
                words={scene.words}
                live={player.playing}
                designing={frame.designing === index && approved}
                reduce={reduce}
              />
            </div>
            <SceneBar scenes={made} player={player} started={started} />
          </motion.div>
        )}
      </AnimatePresence>
      <ProductionLine frame={frame} approved={approved} voice={voice} scenes={made.length} onOpen={() => onOpen(true)} />
    </section>
  );
}
