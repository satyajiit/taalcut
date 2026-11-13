// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { create } from 'zustand';
import { DEFAULT_REEL_ID, SAMPLE_REELS, reelById } from '#content/reels';

/**
 * The hero's signature interaction (WEB2 direction contract, FORM), one pass from the saved reel to your version:
 * shelf (the saved reel plays under its segment bar) → lift (the bar lifts off the reel) → template (it flies into
 * the app window and becomes the template strip; its music beats are read) → sift (the camera roll is searched) →
 * assembled (a clip flies into each slot, one per beat) → ready (every meter full, Approve open) → approved (the
 * visitor's one approval: the reel plays Your version under the same bar).
 *
 * The conductor (components/hero/use-pass.ts) times the pass on the reel's beats and never moves past `ready`: only
 * the visitor approves. Reduced motion settles at `ready` at once. Use template (or another reel) starts a new pass
 * from the lift. The header's mark keeps time from `reelId` (its tempo), `playing` and `phase`.
 */
export const DEMO_PHASES = ['shelf', 'lift', 'template', 'sift', 'assembled', 'ready', 'approved'] as const;
export type DemoPhase = (typeof DEMO_PHASES)[number];

/** What the reel shows: the reel as saved, or the version made from the camera roll (only once approved). */
export type DemoView = 'saved' | 'yours';

export interface DemoState {
  readonly reelId: string;
  readonly phase: DemoPhase;
  /** The visitor's wish: false once they press Pause, until they press Play. The pass and the footage follow it. */
  readonly playing: boolean;
  /** The beat the pass is on, counted on the chosen reel's beats since the pass began. */
  readonly beat: number;
  /** Picks in their slots, in slot order (0 to the reel's slot count). */
  readonly landed: number;
  /** How far the template has been read: the index of the last music beat found, −1 before the read. */
  readonly read: number;
  /** Counts the passes: it moves on each time a pass starts over, so the conductor restarts its clock. */
  readonly run: number;
  readonly view: DemoView;
}

export interface DemoActions {
  /** Choose a saved reel. Its template is taken again, from the lift. Unknown ids and the reel shown are ignored. */
  chooseReel(id: string): void;
  setPhase(phase: DemoPhase): void;
  /** Move one phase on; stays at `approved`. */
  advance(): void;
  setPlaying(playing: boolean): void;
  setBeat(beat: number): void;
  setLanded(landed: number): void;
  setRead(read: number): void;
  /** The pass finished at once (reduced motion): every beat read, every pick in its slot, Approve open. */
  settle(): void;
  /** The one approval: every pick in, and the reel turns to Your version. Only once the pass is ready. */
  approve(): void;
  /** Use template again: a new pass on the same reel, from the lift, back on the saved reel. */
  replay(): void;
  /** The Saved reel / Your version toggle. Your version only exists once approved. */
  setView(view: DemoView): void;
}

export const initialDemoState: DemoState = {
  reelId: DEFAULT_REEL_ID,
  phase: 'shelf',
  playing: true,
  beat: 0,
  landed: 0,
  read: -1,
  run: 0,
  view: 'saved',
};

const at = (phase: DemoPhase) => DEMO_PHASES.indexOf(phase);

/** A fresh pass: nothing read or picked, the saved reel showing, starting at the lift. */
const fresh = (run: number) => ({ phase: 'lift' as const, beat: 0, landed: 0, read: -1, run: run + 1, view: 'saved' as const });

export const useDemoStore = create<DemoState & DemoActions>()((set, get) => ({
  ...initialDemoState,
  chooseReel(id) {
    if (!SAMPLE_REELS.some((r) => r.id === id) || id === get().reelId) return;
    set({ reelId: id, ...fresh(get().run) });
  },
  setPhase(phase) {
    set({ phase });
  },
  advance() {
    const next = DEMO_PHASES[Math.min(at(get().phase) + 1, DEMO_PHASES.length - 1)];
    if (next) set({ phase: next });
  },
  setPlaying(playing) {
    set({ playing });
  },
  setBeat(beat) {
    set({ beat: Math.max(0, Math.floor(beat)) });
  },
  setLanded(landed) {
    const slots = reelById(get().reelId).slots.length;
    set({ landed: Math.max(0, Math.min(Math.floor(landed), slots)) });
  },
  setRead(read) {
    const beats = reelById(get().reelId).beats.length;
    set({ read: Math.max(-1, Math.min(Math.floor(read), beats - 1)) });
  },
  settle() {
    const reel = reelById(get().reelId);
    set({
      phase: at(get().phase) > at('ready') ? get().phase : 'ready',
      landed: reel.slots.length,
      read: reel.beats.length - 1,
    });
  },
  approve() {
    if (at(get().phase) < at('ready')) return;
    const reel = reelById(get().reelId);
    set({ phase: 'approved', landed: reel.slots.length, read: reel.beats.length - 1, view: 'yours' });
  },
  replay() {
    set(fresh(get().run));
  },
  setView(view) {
    if (view === 'yours' && get().phase !== 'approved') return;
    set({ view });
  },
}));
