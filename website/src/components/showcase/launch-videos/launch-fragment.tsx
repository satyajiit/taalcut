// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the launch video's index fragment · mode: Operate · system: WEB2 Remix Vernacular
 * a small working piece of the launch showcase for /features/: Taalcut's launch video playing in its four formats side
 *   by side, its scenes on the segment bar with Pause/Play and the timecode, and the scenes to jump to
 * states: playing (while half on screen; never on its own under reduced motion; the visitor's Pause or Play wins) ·
 *   paused · a scene: playing (current, the ink face) · chosen (the video jumps to its start) · hover · focus · the server HTML (scene 1, the bar filled)
 * motion: the frames cut on the scene's clock; reduced motion: nothing plays until asked */

import { MotionConfig } from 'motion/react';
import { useEffect, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { AppWindow } from '#components/ui/app-window';
import { cn } from '#lib/cn';
import { Chip } from '../chip';
import { ShowcasePlate } from '../plate';
import { FormatFrames } from './format-frames';
import { SceneBar } from './launch-stage';
import { LOOK } from './meta';
import { SCENE_DOT } from './scene-frame';
import { BRIEF, FORMATS, SCENES, secondsLabel, totalSeconds } from './story';
import { useScenePlayer } from './use-player';

const ALL = FORMATS.map((f) => f.id);

export function LaunchFragment() {
  const reduce = useReducedMotionPref();
  const player = useScenePlayer(SCENES, true);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (player.playing) setStarted(true);
  }, [player.playing]);
  const scene = SCENES[player.scene] ?? SCENES[0]!;
  return (
    <MotionConfig reducedMotion="user">
      <AppWindow title="Create" area={LOOK.area} size="md" fit="fluid">
        <ShowcasePlate slug="launch-videos-fragment" label="Taalcut’s launch video, in four formats" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="m-0 me-1 type-section text-ink">{BRIEF.title}</h3>
            <Chip>
              {SCENES.length} scenes · {secondsLabel(totalSeconds(SCENES))}
            </Chip>
            <Chip tone="you">Ready to edit</Chip>
          </div>
          <section ref={player.ref} aria-label="The launch video" className="flex flex-col gap-4 rounded-xl bg-sunken p-3">
            <FormatFrames formats={ALL} scene={scene} index={player.scene} words={scene.words} live={player.playing} designing={false} reduce={reduce} tallest={220} />
            <SceneBar scenes={SCENES} player={player} started={started} />
          </section>
          <div role="group" aria-label="Scenes" className="flex flex-wrap items-center gap-1">
            {SCENES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-current={i === player.scene || undefined}
                aria-label={`Scene ${i + 1}: ${s.words}`}
                onClick={() => {
                  setStarted(true);
                  player.seek(i);
                }}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-pill px-2.5 type-label-sm tabular-nums transition-colors duration-(--dur-micro)',
                  i === player.scene ? 'bg-inverse text-on-inverse' : 'text-ink-2 hover:bg-hover hover:text-ink',
                )}
              >
                <span aria-hidden className={cn('size-2.5 rounded-pill ring-1 ring-rule', SCENE_DOT[s.look])} />
                <span aria-hidden>{i + 1}</span>
              </button>
            ))}
          </div>
        </ShowcasePlate>
      </AppWindow>
    </MotionConfig>
  );
}
