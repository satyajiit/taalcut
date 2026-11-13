// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Fixed, locally authored cues. Completion takes precedence over a small action; nothing is queued. */
export const SOUND_NAMES = [
  'promptSent',
  'editApplied',
  'undo',
  'redo',
  'importDone',
  'draftAssembled',
  'complete',
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

/** One sound's player. */
export interface SoundVoice {
  /** Plays from the start. Rejects when the browser won't. */
  play(): Promise<void>;
  /** Stops and rewinds. */
  stop(): void;
  readonly playing: boolean;
}

export interface SoundPlayerOptions {
  /** Makes a sound's voice, once, on first use; null when this browser can't play it. */
  voice: (name: SoundName) => SoundVoice | null;
  /** The Settings switch, read on every call. */
  enabled: () => boolean;
  now?: () => number;
}

export interface SoundPlayer {
  /** Makes every voice now, so the first cue starts at once. Nothing while off. */
  preload(): void;
  /** Whether it started. */
  play(name: SoundName): boolean;
  stopAll(): void;
}

export const ACTION_COOLDOWN_MS = 250;
const MILESTONES: ReadonlySet<SoundName> = new Set(['importDone', 'draftAssembled', 'complete']);

interface PlayingCue {
  name: SoundName;
  voice: SoundVoice;
  pending: boolean;
}

export function createSoundPlayer({ voice, enabled, now = Date.now }: SoundPlayerOptions): SoundPlayer {
  const voices = new Map<SoundName, SoundVoice | null>();
  let active: PlayingCue | null = null;
  let lastActionAt = -Infinity;

  const voiceOf = (name: SoundName): SoundVoice | null => {
    if (!voices.has(name)) {
      try {
        voices.set(name, voice(name));
      } catch {
        voices.set(name, null);
      }
    }
    return voices.get(name) ?? null;
  };

  function preload(): void {
    if (!enabled()) return;
    for (const name of SOUND_NAMES) voiceOf(name);
  }

  /** A pending play owns the channel too, even before the media element reports playback. */
  function makeRoom(name: SoundName): boolean {
    if (active && !active.pending && !active.voice.playing) active = null;
    if (!active) return true;
    if (MILESTONES.has(active.name) || !MILESTONES.has(name)) return false;
    active.voice.stop();
    active = null;
    return true;
  }

  function play(name: SoundName): boolean {
    if (!enabled()) return false;
    preload();
    const mine = voiceOf(name);
    const at = now();
    const action = !MILESTONES.has(name);
    if (action && at - lastActionAt < ACTION_COOLDOWN_MS) return false;
    if (!mine || !makeRoom(name)) return false;
    const attempt: PlayingCue = { name, voice: mine, pending: true };
    active = attempt;
    if (action) lastActionAt = at;
    try {
      void mine.play().then(
        () => {
          attempt.pending = false;
          // A disable/preemption can win while play() waits for decoding. Never revive its sound later.
          if (active !== attempt && active?.voice !== mine) mine.stop();
        },
        () => {
          if (active === attempt) active = null;
        },
      );
    } catch {
      if (active === attempt) active = null;
      return false;
    }
    return true;
  }

  function stopAll(): void {
    active = null;
    for (const sound of voices.values()) sound?.stop();
  }

  return { preload, play, stopAll };
}

/** The AAC the sounds ship as (tools/audio-packs/build-interface-sounds.mjs). */
const AAC = 'audio/mp4; codecs="mp4a.40.2"';

/**
 * A voice on an `<audio>` element: it loads at once (preload), keeps no audio device open between plays, and
 * plays at `volume`. Null where there is no audio or it can't play AAC (jsdom, a stripped-down browser).
 */
export function audioVoice(url: string, volume: number): SoundVoice | null {
  if (typeof Audio !== 'function') return null;
  const element = new Audio();
  if (!element.canPlayType(AAC)) return null;
  element.preload = 'auto';
  element.volume = volume;
  element.src = url;
  return {
    get playing() {
      return !element.paused && !element.ended;
    },
    play() {
      element.currentTime = 0;
      return element.play();
    },
    stop() {
      element.pause();
      element.currentTime = 0;
    },
  };
}
