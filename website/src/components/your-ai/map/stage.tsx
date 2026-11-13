// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the map of what leaves your computer · mode: Persuade · system: WEB2 Remix Vernacular
 * states: finished (the server HTML, on screen at load, reduced motion: every card resting where it goes, a pass on
 *   the gate for each thing that crosses) · arriving (once, when it comes on screen: the cards come through the gate
 *   in turn, under three seconds) · playing (while on screen, faint passes keep sliding through the gate; Pause the
 *   map stops them, Play the map runs the arrival again and plays on) · On this Mac (the AI's mark flies home with
 *   the cloud lane's card, speech drops, the violet zone greys) · Local only (a teal wall closes the gate, every card
 *   but the update check comes home and waits against it, captioned with what stays) · the control: default · hover ·
 *   focus (base ring) · active (4 % give) · gone under reduced motion · without JavaScript (Everyday, Local only off).
 * Three zones: your computer (teal), the gate, and outside your computer, where the AI you chose is a violet zone
 * and the rest is plain ground, since the app's words say those leave, not where to. Side by side from 1024 px; on a
 * phone, stacked, with things passing down through the gate. */

import { Pause, Play } from 'lucide-react';
import { LayoutGroup, MotionConfig, motion, type Variants } from 'motion/react';
import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useReplay } from '#components/home/kit';
import { AI_MAP } from '#content/ai-map';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { POP } from '#lib/motion';
import { EmptySlot, MapCard } from './cards';
import { Gate } from './gate';
import { aiHome, cloudSide, type Lane, lanes, type MapState, placeOf } from './model';
import { ComputerZone, OutsideZone } from './zones';

/**
 * The pile against the wall from 1024 px: each card resting home tilts and tucks under the one above, like stickers
 * pressed to the border, the biggest (the cloud lane's) at the back.
 */
const PILE = ['lg:-rotate-2', 'lg:-mt-2 lg:me-12 lg:rotate-3', 'lg:-mt-1 lg:me-3 lg:-rotate-2', 'lg:-mt-1 lg:me-16 lg:rotate-2'] as const;

/** Seconds into the run that the first card comes through the gate, and between cards. */
const CARD_AT = 0.45;
const CARD_STEP = 0.22;

const WIDE = '(min-width: 64rem)';
/** Whether the zones sit side by side (from 1024 px): the way things pass through the gate. False on the server. */
function useWide(): boolean {
  return useSyncExternalStore(
    (change) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(WIDE);
      list.addEventListener('change', change);
      return () => list.removeEventListener('change', change);
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches,
    () => false,
  );
}

/** True while some of the element is on screen in a shown tab. */
function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    let seen = false;
    const update = () => setOn(seen && document.visibilityState !== 'hidden');
    const observer = new IntersectionObserver(
      ([entry]) => {
        seen = Boolean(entry?.isIntersecting);
        update();
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [ref]);
  return on;
}

/** A card's arrival: from your side of the gate (left from 1024 px, above on a phone) into its place. */
function enter(index: number, wide: boolean): Variants {
  const from = wide ? { x: -88, y: 0 } : { x: 0, y: -48 };
  return {
    hidden: { ...from, opacity: 0, transition: { duration: 0 } },
    shown: { x: 0, y: 0, opacity: 1, transition: { ...POP.spring, stiffness: 260, damping: 26, delay: CARD_AT + index * CARD_STEP } },
  };
}

function PlayControl({ paused, onToggle }: { readonly paused: boolean; readonly onToggle: () => void }) {
  const label = paused ? AI_MAP.play : AI_MAP.pause;
  const Glyph = paused ? Play : Pause;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      data-slot="map-play"
      className={cn(
        'absolute top-4 right-4 z-40 inline-grid size-10 place-items-center rounded-pill border border-rule bg-control text-ink select-none sm:top-6 sm:right-6',
        'transition-[background-color,transform] duration-(--dur-micro) ease-(--ease-out) hover:bg-control-hover active:scale-[0.96] active:bg-control-pressed',
      )}
    >
      <Glyph aria-hidden strokeWidth={ICON_STROKE} className="size-4" fill="currentColor" />
    </button>
  );
}

export function MapStage({ state, labelledBy }: { readonly state: MapState; readonly labelledBy: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { state: run, replay, reduce } = useReplay(ref, 0.2);
  const wide = useWide();
  const onScreen = useOnScreen(ref);
  const [paused, setPaused] = useState(false);
  const [arriving, setArriving] = useState(false);
  const rows = lanes(state);
  const side = cloudSide(state);
  const aiHere = aiHome(state) === 'computer';
  const crossing = rows.filter((l) => l.crosses);

  // A run starts from 'hidden'; once it plays to 'shown', the cards come through in turn until the last has landed.
  useEffect(() => {
    if (run === 'hidden') {
      setArriving(true);
      return undefined;
    }
    const done = window.setTimeout(() => setArriving(false), (CARD_AT + rows.length * CARD_STEP + 0.9) * 1000);
    return () => window.clearTimeout(done);
  }, [run, rows.length]);

  const at = (lane: Lane) => placeOf(lane, state);
  const cloud = rows.find((l) => l.id === 'cloud')!;
  const plain = rows.filter((l) => l.id !== 'cloud');
  const home = rows.filter((l) => at(l) === 'local' || at(l) === 'held');
  // The held lanes whose words are what stays (reel links, jobs with no local model): said once, under the pile.
  const said = home.filter((l) => at(l) === 'held' && (l.id === 'cloud' || l.id === 'links'));
  const travelling = !reduce && !paused && onScreen && run === 'shown' && !arriving;
  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id="ai-map">
        <motion.div
          ref={ref}
          role="group"
          aria-labelledby={labelledBy}
          data-slot="map-stage"
          data-local-only={state.localOnly ? 'true' : 'false'}
          data-profile={state.profile}
          data-run={run}
          data-playing={travelling ? 'true' : 'false'}
          initial={false}
          animate={run}
          className="relative isolate grid overflow-hidden rounded-reel shadow-window ring-1 ring-rule-subtle lg:grid-cols-[minmax(0,5fr)_minmax(6rem,1fr)_minmax(0,6fr)]"
        >
          <ComputerZone
            aiHere={aiHere}
            reduce={reduce}
            held={said}
            home={home.map((l, i) => (
              <MapCard key={l.id} lane={l} place={at(l)} caption={said.includes(l) ? 'none' : 'name'} className={PILE[i]} />
            ))}
          />
          <Gate crossing={crossing.map((l) => l.id)} wall={state.localOnly} travelling={travelling} wide={wide} reduce={reduce} />
          <OutsideZone
            side={side}
            aiHere={aiHere}
            reduce={reduce}
            ai={at(cloud) === 'ai' ? <MapCard lane={cloud} place="ai" enter={enter(0, wide)} /> : null}
            outside={plain.map((l) =>
              at(l) === 'outside' ? <MapCard key={l.id} lane={l} place="outside" enter={enter(rows.indexOf(l), wide)} /> : <EmptySlot key={l.id} lane={l} />,
            )}
            control={
              reduce ? null : (
                <PlayControl
                  paused={paused}
                  onToggle={() => {
                    if (paused) replay();
                    setPaused(!paused);
                  }}
                />
              )
            }
          />
        </motion.div>
      </LayoutGroup>
    </MotionConfig>
  );
}
