// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The clip page's player, without React: it drives a <video> playing the clip's proxy and keeps the clock (the
 * playhead) in step with it. Seeks are coalesced: while the video is still seeking, only the latest target waits,
 * so a drag on the scrubber never queues up a backlog of frames. J K L shuttle as an editor's do: L plays and
 * then plays faster, J plays backwards (the <video> can't, so the clock steps back each frame and the video seeks
 * after it), K stops. Looping keeps the shot at the playhead playing.
 */
import { shotAt, type ShotSpan, type Span } from '../clip-time';
import type { ClipClock } from './clip-clock';

/** The part of an HTMLVideoElement the player uses (so tests can hand it a stand-in). */
export interface VideoLike {
  currentTime: number;
  playbackRate: number;
  muted: boolean;
  readonly paused: boolean;
  readonly seeking: boolean;
  play(): Promise<void>;
  pause(): void;
}

export interface PlayerSnapshot {
  readonly playing: boolean;
  readonly muted: boolean;
  readonly looping: boolean;
  /** J K L: 0 stopped; 1, 2, 4 forwards; −1, −2, −4 backwards. */
  readonly shuttle: number;
  /** The video knows its length and can seek. */
  readonly ready: boolean;
  /** Its first frame is decoded: the poster can go. */
  readonly shown: boolean;
  /** Waiting for data mid-play. */
  readonly buffering: boolean;
  /** The video couldn't load (the file is gone, or unreadable). */
  readonly failed: boolean;
}

export const STOPPED: PlayerSnapshot = {
  playing: false,
  muted: false,
  looping: false,
  shuttle: 0,
  ready: false,
  shown: false,
  buffering: false,
  failed: false,
};

export interface PlayerTimeline {
  /** The clip's length, ms. */
  readonly length: number;
  /** One frame, ms. */
  readonly frameMs: number;
  readonly spans: readonly ShotSpan[];
}

export interface PlayerFrames {
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

const FASTEST = 4;

/** The <video> events the player follows. */
export const VIDEO_EVENTS = [
  'loadedmetadata',
  'loadeddata',
  'play',
  'pause',
  'seeked',
  'waiting',
  'playing',
  'ended',
  'error',
  'volumechange',
] as const;
export type VideoEvent = (typeof VIDEO_EVENTS)[number];

export function createPlayerControl(
  clock: ClipClock,
  onChange: (snapshot: PlayerSnapshot) => void,
  frames: PlayerFrames,
) {
  let video: VideoLike | null = null;
  let timeline: PlayerTimeline = { length: 0, frameMs: 1000 / 30, spans: [] };
  let snapshot = STOPPED;
  let pending: number | null = null;
  let loop: Span | null = null;
  let tick: number | null = null;
  let lastNow: number | null = null;
  let resumeAfterGrab = false;

  const update = (next: Partial<PlayerSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    onChange(snapshot);
  };
  const clamp = (at: number) => Math.min(Math.max(0, at), timeline.length);
  const loopSpan = (at: number): Span => shotAt(timeline.spans, at) ?? { from: 0, to: timeline.length };

  /** Ask the video for a time; while it is still busy with the last one, only the newest waits. */
  const seekVideo = (at: number) => {
    if (!video || !snapshot.ready) return;
    if (video.seeking) pending = at;
    else video.currentTime = at / 1000;
  };

  const stopTicking = () => {
    if (tick !== null) frames.cancel(tick);
    tick = null;
    lastNow = null;
  };
  const onFrame = (now: number) => {
    tick = null;
    if (!video) return;
    if (snapshot.shuttle < 0) {
      const step = lastNow === null ? 0 : (now - lastNow) * -snapshot.shuttle;
      const at = clamp(clock.get() - step);
      clock.set(at);
      seekVideo(at);
      if (at <= 0) return halt();
    } else if (!video.paused) {
      const at = clamp(video.currentTime * 1000);
      clock.set(at);
      if (snapshot.looping && loop && at >= loop.to - timeline.frameMs / 2) {
        clock.set(loop.from);
        video.currentTime = loop.from / 1000;
      }
    } else return stopTicking();
    lastNow = now;
    tick = frames.request(onFrame);
  };
  const startTicking = () => {
    if (tick === null) tick = frames.request(onFrame);
  };

  const sync = () => {
    if (!video) return;
    update({ playing: !video.paused || snapshot.shuttle < 0 });
  };
  /** Stop: no play, no shuttle, back to normal speed. */
  const halt = () => {
    stopTicking();
    if (video) {
      video.pause();
      video.playbackRate = 1;
    }
    update({ playing: false, shuttle: 0 });
  };
  const playForward = (rate: number) => {
    if (!video || !snapshot.ready) return;
    stopTicking();
    if (clock.get() >= timeline.length - timeline.frameMs) {
      clock.set(loop?.from ?? 0);
      video.currentTime = clock.get() / 1000;
    }
    video.playbackRate = rate;
    update({ shuttle: rate });
    void video.play().then(sync, sync);
    startTicking();
  };
  const playBackward = (rate: number) => {
    if (!video || !snapshot.ready) return;
    // Faster backwards keeps the same frame loop: the next frame steps at the new speed.
    const reversing = snapshot.shuttle < 0;
    video.pause();
    video.playbackRate = 1;
    update({ shuttle: -rate, playing: true });
    if (reversing) return;
    stopTicking();
    startTicking();
  };

  return {
    get snapshot() {
      return snapshot;
    },
    configure(next: PlayerTimeline) {
      timeline = next;
    },
    attach(element: VideoLike | null) {
      if (element === video) return;
      halt();
      video = element;
      pending = null;
      update({ ...STOPPED, muted: element?.muted ?? false, looping: snapshot.looping });
    },
    /** The <video>'s own events, as they come. */
    event(name: VideoEvent) {
      if (!video) return;
      if (name === 'loadedmetadata') {
        update({ ready: true, failed: false });
        if (clock.get() > 0) seekVideo(clock.get());
      } else if (name === 'loadeddata') update({ shown: true });
      else if (name === 'play') {
        update({ playing: true });
        startTicking();
      } else if (name === 'pause') {
        if (snapshot.shuttle >= 0) update({ playing: false, shuttle: 0 });
      } else if (name === 'seeked') {
        const next = pending;
        pending = null;
        if (next !== null && Math.abs(next / 1000 - video.currentTime) > 0.0005)
          video.currentTime = next / 1000;
      } else if (name === 'waiting') update({ buffering: true });
      else if (name === 'playing') update({ buffering: false });
      else if (name === 'ended') {
        clock.set(timeline.length);
        if (snapshot.looping && loop) playForward(1);
        else halt();
      } else if (name === 'error') {
        halt();
        update({ failed: true, ready: false });
      } else update({ muted: video.muted });
    },
    toggle() {
      if (snapshot.playing) halt();
      else playForward(1);
    },
    play: () => playForward(1),
    pause: halt,
    /** L forwards, J backwards: again in the same direction goes twice as fast, up to 4×. */
    shuttle(direction: -1 | 1) {
      const now = snapshot.shuttle;
      const rate = Math.sign(now) === direction ? Math.min(FASTEST, Math.abs(now) * 2) : 1;
      if (direction === 1) playForward(rate);
      else playBackward(rate);
    },
    seek(at: number) {
      const to = clamp(at);
      clock.set(to);
      seekVideo(to);
      if (snapshot.looping && loop && (to < loop.from || to >= loop.to)) loop = loopSpan(to);
    },
    /** One frame back or on, landing mid-frame so the decoder shows that frame and no other. */
    stepFrame(direction: -1 | 1) {
      halt();
      const { frameMs, length } = timeline;
      const index = Math.floor(clock.get() / frameMs) + direction;
      const last = Math.max(0, Math.floor((length - 1) / frameMs));
      const to = (Math.min(Math.max(0, index), last) + 0.5) * frameMs;
      clock.set(Math.min(to, length));
      seekVideo(clock.get());
    },
    /** A drag on the scrubber takes the playhead: playing stops while it moves and picks up where it is let go. */
    grab() {
      resumeAfterGrab = snapshot.playing && snapshot.shuttle > 0;
      if (snapshot.playing) halt();
    },
    release() {
      if (resumeAfterGrab) playForward(1);
      resumeAfterGrab = false;
    },
    toggleMute() {
      if (video) video.muted = !video.muted;
    },
    toggleLoop() {
      loop = snapshot.looping ? null : loopSpan(clock.get());
      update({ looping: !snapshot.looping });
    },
    dispose() {
      stopTicking();
      video = null;
    },
  };
}

export type PlayerControl = ReturnType<typeof createPlayerControl>;
