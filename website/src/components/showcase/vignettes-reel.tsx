// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the reel's vignettes · mode: Persuade · system: WEB2 Remix Vernacular
 * for Read any reel (Reels become templates has its own, in templates/scenes.tsx):
 * one small scene per fact, acted out once on arrival and again under the pointer (vignette.tsx): the sources a reel
 *   comes from; a playhead reading a strip and striking its beats, cuts and text; a cut moved and the tempo halved;
 *   the music kept on your computer with its switch
 * states: start · end (the server's and reduced motion's) · replay. Decorative, aria-hidden: the fact says it. */

import { FileVideo, Laptop, Link, Music, Type } from 'lucide-react';
import { BrandIcon } from '#components/brand/brand-icon';
import { DEFAULT_REEL_ID, reelById } from '#content/reels';
import { Filmstrip } from './frame';
import { frameOf, framesOf } from './frames';
import { act, beat, motion, pop, type Scene, SceneChip, VignetteFrame } from './vignette';

const reel = () => reelById(DEFAULT_REEL_ID);

/** Takes: links from the three apps, or a file, into the paste field. */
export function SourcesScene(scene: Scene) {
  const { reduce } = scene;
  const sources = [
    {
      key: 'reels',
      body: (
        <>
          <BrandIcon id="instagram" themeAware={false} /> Reels
        </>
      ),
      tilt: -6,
    },
    {
      key: 'shorts',
      body: (
        <>
          <BrandIcon id="youtube" /> Shorts
        </>
      ),
      tilt: 3,
    },
    {
      key: 'tiktok',
      body: (
        <>
          <BrandIcon id="tiktok" /> TikTok
        </>
      ),
      tilt: -2,
    },
  ];
  return (
    <VignetteFrame>
      <div className="absolute inset-x-0 top-5 flex justify-center gap-2">
        {sources.map((s, i) => (
          <motion.span
            key={s.key}
            {...act(
              scene,
              { opacity: 0, y: 14, scale: 0.6, rotate: 0 },
              { opacity: 1, y: 0, scale: 1, rotate: s.tilt },
              pop(0.1 + i * 0.12, reduce),
            )}
          >
            <SceneChip>{s.body}</SceneChip>
          </motion.span>
        ))}
      </div>
      <div className="absolute inset-x-5 bottom-5 flex h-10 items-center gap-2 rounded-pill border-[1.5px] border-dashed border-rule-strong bg-canvas px-3">
        <Link className="size-4 shrink-0 text-ink-3" />
        <span className="h-2 w-2/5 rounded-pill bg-rule" />
        <motion.span
          className="ms-auto"
          {...act(scene, { opacity: 0, y: -40 }, { opacity: 1, y: 0 }, beat(0.6, reduce, 0.55))}
        >
          <SceneChip className="bg-rose-soft text-rose-strong shadow-none">
            <FileVideo /> reel.mp4
          </SceneChip>
        </motion.span>
      </div>
    </VignetteFrame>
  );
}

/** Finds: a playhead reads a strip of the reel; beats, cuts and the text on screen strike as it passes. */
export function ReadScene(scene: Scene) {
  const { reduce } = scene;
  const r = reel();
  const shots = [r.slots[0], r.slots[2], r.slots[5], r.slots[12]];
  const cuts = [0.25, 0.5, 0.75];
  const beats = Array.from({ length: 12 }, (_, i) => (i + 0.5) / 12);
  return (
    <VignetteFrame>
      <Filmstrip
        sprites={shots.map((s) => frameOf(s?.pick.clipId) ?? 0)}
        count={14}
        className="absolute inset-x-5 top-6 h-14 rounded-lg"
      />
      {cuts.map((c) => (
        <motion.span
          key={c}
          className="absolute top-5 h-16 w-0.5 origin-bottom rounded-pill bg-rose-strong"
          style={{ left: `calc(1.25rem + (100% - 2.5rem) * ${c})` }}
          {...act(scene, { scaleY: 0 }, { scaleY: 1 }, beat(0.2 + c * 1.4, reduce, 0.3))}
        />
      ))}
      {beats.map((b) => (
        <motion.span
          key={b}
          className="absolute top-[5.25rem] h-2 w-0.5 origin-top rounded-pill bg-rose"
          style={{ left: `calc(1.25rem + (100% - 2.5rem) * ${b})` }}
          {...act(
            scene,
            { scaleY: 0, opacity: 0 },
            { scaleY: 1, opacity: 1 },
            beat(0.2 + b * 1.4, reduce, 0.25),
          )}
        />
      ))}
      <motion.span
        className="absolute top-[6.25rem] left-5"
        {...act(scene, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, pop(0.5, reduce))}
      >
        <SceneChip className="py-0.5 text-[0.75rem]">
          <Type /> How’s Vietnam?
        </SceneChip>
      </motion.span>
      {/* The playhead reads the reel and goes: it renders only once a run starts (the end state has none). */}
      {scene.ran ? (
        <span className="absolute inset-x-5 top-4 bottom-8">
          <motion.span
            className="absolute inset-0"
            {...act(
              scene,
              { x: '0%', opacity: 1 },
              { x: '100%', opacity: 0 },
              reduce
                ? { duration: 0.15 }
                : { duration: 1.5, ease: 'linear', opacity: { delay: 1.4, duration: 0.2 } },
            )}
          >
            <span className="absolute inset-y-0 left-0 w-0.5 -translate-x-px rounded-pill bg-playhead-strong" />
          </motion.span>
        </span>
      ) : null}
    </VignetteFrame>
  );
}

/** You can: a cut the AI wasn't sure of moves on to its frame and turns yours; the tempo halves. */
export function FixScene(scene: Scene) {
  const { reduce } = scene;
  return (
    <VignetteFrame>
      <div className="absolute inset-x-5 top-5 flex h-12 gap-0.5 overflow-hidden rounded-lg">
        <Filmstrip sprites={framesOf('vietnam-05')} count={6} className="h-full flex-1" />
        <Filmstrip sprites={framesOf('vietnam-06')} count={6} className="h-full flex-1" />
      </div>
      <motion.span
        className="absolute top-3.5 left-1/2 flex h-15 w-3 -translate-x-1/2 justify-center"
        {...act(scene, { x: -22 }, { x: 0 }, beat(0.3, reduce, 0.6))}
      >
        <span className="h-full w-1 rounded-pill bg-violet-strong" />
        <motion.span
          className="absolute inset-y-0 w-1 rounded-pill bg-teal-strong"
          {...act(scene, { opacity: 0 }, { opacity: 1 }, beat(0.7, reduce, 0.3))}
        />
        {/* The not-sure circle goes once the cut is yours: it renders only once a run starts. */}
        {scene.ran ? (
          <motion.span
            className="absolute -top-1.5 size-3 rounded-pill border-2 border-dashed border-violet-strong bg-canvas"
            {...act(scene, { opacity: 1, scale: 1 }, { opacity: 0, scale: 0.4 }, beat(0.7, reduce, 0.25))}
          />
        ) : null}
      </motion.span>
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-pill bg-control p-0.5 text-[0.75rem] font-semibold text-ink-2">
        {['½×', '1×', '2×'].map((label) => (
          <span key={label} className="relative z-10 inline-grid h-7 w-10 place-items-center">
            {label}
          </span>
        ))}
        <motion.span
          className="absolute top-0.5 left-0.5 h-7 w-10 rounded-pill border border-rule-strong bg-raised shadow-xs"
          {...act(scene, { x: 42 }, { x: 0 }, beat(1.1, reduce, 0.4))}
        />
      </div>
    </VignetteFrame>
  );
}

/** The music: the reel's music lands on your computer, and its switch is on by default. */
export function MusicScene(scene: Scene) {
  const { reduce } = scene;
  return (
    <VignetteFrame>
      <div className="absolute inset-0 flex items-center justify-center gap-6">
        <span className="relative inline-grid size-16 place-items-center rounded-2xl bg-raised text-ink-2 shadow-sticker">
          <Laptop className="size-8" strokeWidth={1.75} />
          <motion.span
            className="absolute -top-3 -left-8"
            {...act(
              scene,
              { x: -40, y: -6, opacity: 0, rotate: -20 },
              { x: 0, y: 0, opacity: 1, rotate: -8 },
              pop(0.15, reduce),
            )}
          >
            <SceneChip className="bg-rose-soft text-rose-strong">
              <Music /> Music
            </SceneChip>
          </motion.span>
        </span>
        <span className="flex flex-col items-start gap-2">
          <span className="inline-flex h-7 w-12 items-center rounded-pill bg-teal p-0.5">
            <motion.span
              className="size-6 rounded-pill bg-raised shadow-sm"
              {...act(scene, { x: 0 }, { x: 20 }, beat(0.75, reduce, 0.35))}
            />
          </span>
          <span className="flex items-end gap-0.5">
            {[0.5, 0.9, 0.6, 1, 0.7, 0.4].map((h, i) => (
              <motion.span
                key={i}
                className="w-1 origin-bottom rounded-pill bg-rose"
                style={{ height: `${h * 1.25}rem` }}
                {...act(scene, { scaleY: 0.2 }, { scaleY: 1 }, beat(0.9 + i * 0.06, reduce, 0.35))}
              />
            ))}
          </span>
        </span>
      </div>
    </VignetteFrame>
  );
}
