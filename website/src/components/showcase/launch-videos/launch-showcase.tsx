// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a product launch video, from a brief · mode: Operate · system: WEB2 Remix Vernacular
 * Create › Product launch in the coded app window, open on Create: Taalcut's own launch video, made from taalcut.app,
 *   leads. It plays in every format the brief chose, side by side, its scenes on the segment bar and production on
 *   one line under it (launch-stage.tsx); the brief, the sources and the script are a compact rail under the video
 *   (brief-rail.tsx, script-rail.tsx), and the script's ink Approve is the one go-ahead before anything is made
 * states: the arrival (once, when scrolled to: Approve pressed, production designing the video scene by scene, the
 *   voiceover, the review, then the video playing, under five seconds; said once to screen readers) · finished (the
 *   server HTML, already on screen at load, reduced motion: approved, the video ready at its first scene) · playing ·
 *   paused · a changed script (a new version: production waits for its approval, then makes the video again) · a
 *   format turned off or on · in the editor · Play again (the arrival from the start, the visitor's changes undone)
 * motion: the arrival is the page's one orchestrated moment; reduced motion: everything finished, nothing plays
 *   until the visitor asks, and then at once */

import { ListOrdered, RotateCcw, SquarePen } from 'lucide-react';
import { MotionConfig } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { AppWindow } from '#components/ui/app-window';
import { buttonClasses } from '#components/ui/button-classes';
import { Sticker } from '#components/ui/sticker';
import { Chip } from '../chip';
import { ShowcasePlate } from '../plate';
import { prefersReducedMotion, useArrival } from '../use-arrival';
import { BriefRail } from './brief-rail';
import { LaunchStage } from './launch-stage';
import { LOOK } from './meta';
import { passAt, passEnds, passTimes, PASS } from './pass';
import { ScriptRail } from './script-rail';
import { type Aspect, BRIEF, changeSeconds, FORMATS, SCENES, sceneSpans, toggleFormat, type Voice } from './story';
import { useScenePlayer } from './use-player';

const ALL_FORMATS: readonly Aspect[] = FORMATS.map((f) => f.id);

/** Timers for a run of moments: each calls `on` with its time; a new run or `stop` clears the last. */
function useTimers() {
  const timers = useRef<number[]>([]);
  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);
  const run = useCallback(
    (times: readonly number[], from: number, on: (at: number) => void) => {
      stop();
      timers.current = times.map((t) => window.setTimeout(() => on(t), t - from));
    },
    [stop],
  );
  useEffect(() => stop, [stop]);
  return useMemo(() => ({ run, stop }), [run, stop]);
}

export function LaunchShowcase() {
  const reduce = useReducedMotionPref();
  const [box, phase] = useArrival<HTMLDivElement>(0.3, 0.6);
  const timers = useTimers();
  const [scenes, setScenes] = useState(SCENES);
  const [made, setMade] = useState(SCENES);
  const [ms, setMs] = useState(() => passEnds(SCENES.length).end);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [pressed, setPressed] = useState(0);
  const [version, setVersion] = useState(1);
  const [approvedVersion, setApprovedVersion] = useState(1);
  const [formats, setFormats] = useState<readonly Aspect[]>(ALL_FORMATS);
  const [voice, setVoice] = useState<Voice>('connected');
  const [opened, setOpened] = useState(false);

  const frame = passAt(ms, made.length);
  const approved = approvedVersion === version && frame.approved;
  const player = useScenePlayer(made, approved && frame.ready);
  const { hold, reset } = player;

  /** Production from `from` ms to its end, for this version's scenes; the scene bar fills as each is designed. */
  const produce = useCallback(
    (from: number, count: number, spans: readonly (readonly [number, number])[]) => {
      setRunning(true);
      setStarted(true);
      setMs(from);
      hold(0);
      timers.run(passTimes(count, from), from, (at) => {
        setMs(at);
        if (at === PASS.approve && from < PASS.approve) setPressed((n) => n + 1);
        const done = passAt(at, count).designed;
        hold(done > 0 ? (spans[done - 1]?.[1] ?? 0) : 0);
        if (at >= passEnds(count).end) {
          setRunning(false);
          hold(0);
        }
      });
    },
    [hold, timers],
  );

  useEffect(() => {
    if (phase === 'waiting') {
      setMs(-1);
      setRunning(true);
    } else if (phase === 'play') produce(0, SCENES.length, sceneSpans(SCENES));
  }, [phase, produce]);

  const restart = () => {
    timers.stop();
    setScenes(SCENES);
    setMade(SCENES);
    setVersion(1);
    setApprovedVersion(1);
    setFormats(ALL_FORMATS);
    setVoice('connected');
    setOpened(false);
    reset();
    if (prefersReducedMotion()) {
      setMs(passEnds(SCENES.length).end);
      setRunning(false);
      return;
    }
    produce(0, SCENES.length, sceneSpans(SCENES));
  };
  /** A change to the script: a new version, unless this one is already waiting for approval. */
  const edited = () => setVersion((v) => (v === approvedVersion ? v + 1 : v));
  const approve = () => {
    // The pill is disabled once approved: hand focus to the video's own control.
    window.requestAnimationFrame(() => box.current?.querySelector<HTMLElement>('[data-slot="play-control"]')?.focus());
    setApprovedVersion(version);
    setMade(scenes);
    setOpened(false);
    reset();
    if (prefersReducedMotion()) {
      timers.stop();
      setMs(passEnds(scenes.length).end);
      setRunning(false);
      return;
    }
    produce(PASS.approve, scenes.length, sceneSpans(scenes));
  };

  // Once the video has played, or the visitor has moved it, the scene bar follows its clock.
  useEffect(() => {
    if (player.playing) setStarted(true);
  }, [player.playing]);
  const shown = frame.ready ? player.scene : (frame.designing ?? Math.max(0, frame.designed - 1));

  const status = !approved ? 'Ready for review' : frame.ready ? 'Ready to edit' : 'Creating video';

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative">
        <AppWindow title="Create" area={LOOK.area} size="lg" fit="fluid">
          <ShowcasePlate slug="launch-videos" label="Taalcut’s launch video, made from a brief" className="flex flex-col gap-5">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h3 className="m-0 type-page-title text-ink">{BRIEF.title}</h3>
              <Chip tone={approved && frame.ready ? 'you' : 'neutral'}>{status}</Chip>
              <button type="button" className={buttonClasses('secondary', 'md', 'ms-auto')} onClick={restart}>
                <RotateCcw aria-hidden className="size-4" />
                Play again
              </button>
              <span role="status" className="sr-only">
                {running && frame.approved ? 'Making the launch video, scene by scene.' : started && approved && frame.ready ? 'The launch video is ready.' : ''}
              </span>
            </header>
            <div ref={box} data-pass={running ? 'playing' : 'finished'} className="min-w-0">
              <LaunchStage
                made={made}
                formats={formats}
                voice={voice}
                frame={frame}
                approved={approved}
                player={player}
                started={started}
                opened={opened}
                onOpen={setOpened}
                reduce={reduce}
              />
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-6 @min-[52rem]:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <BriefRail
                formats={formats}
                onFormat={(f) => setFormats((all) => toggleFormat(all, f))}
                voice={voice}
                onVoice={setVoice}
              />
              <ScriptRail
                scenes={scenes}
                playing={shown}
                onPlay={(i) => {
                  setOpened(false);
                  setStarted(true);
                  player.seek(i);
                }}
                onWords={(i, words) => {
                  setScenes((all) => all.map((s, k) => (k === i ? { ...s, words } : s)));
                  edited();
                }}
                onSeconds={(i, by) => {
                  setScenes((all) => all.map((s, k) => (k === i ? { ...s, seconds: changeSeconds(s.seconds, by) } : s)));
                  edited();
                }}
                version={version}
                approved={approved}
                pressed={pressed}
                onApprove={approve}
              />
            </div>
          </ShowcasePlate>
        </AppWindow>
        <span className="absolute -top-4 right-6 z-10 hidden sm:block">
          <Sticker field="violet" icon={ListOrdered} tilt={3}>
            Up to 12 scenes
          </Sticker>
        </span>
        <span className="absolute right-10 -bottom-4 z-10">
          <Sticker field="sky" icon={SquarePen} tilt={-3} delay={0.12}>
            Opens in the editor
          </Sticker>
        </span>
      </div>
    </MotionConfig>
  );
}
