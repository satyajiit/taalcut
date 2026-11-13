// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX2: the clip page's player without React, over a stand-in <video>: the clock follows the video while it plays;
// seeks while the video is still seeking keep only the newest; a frame step lands mid-frame; J K L shuttle (J moves
// the clock back itself, the video seeking after it); a drag pauses and picks up where it was let go; looping keeps
// the shot at the playhead playing.
import { describe, expect, it } from 'vitest';
import { CLIP_FIXTURE } from '../src/features/library/clip/clip-fixture';
import { shotSpans } from '../src/features/library/clip/clip-time';
import { createClipClock } from '../src/features/library/clip/player/clip-clock';
import {
  createPlayerControl,
  type PlayerSnapshot,
  type VideoLike,
} from '../src/features/library/clip/player/player-control';

/** A video whose seeks settle when the test says, and whose play starts at once. */
class FakeVideo implements VideoLike {
  playbackRate = 1;
  muted = false;
  paused = true;
  seeking = false;
  seeks: number[] = [];
  #time = 0;
  get currentTime() {
    return this.#time;
  }
  set currentTime(value: number) {
    this.#time = value;
    this.seeking = true;
    this.seeks.push(value);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  /** The video plays on by itself. */
  advance(seconds: number) {
    this.#time += seconds;
  }
}

// The fixture: 29 s at 30 fps, shots from frames 0, 120, 330, 450 and 600.
const spans = shotSpans(CLIP_FIXTURE.shots);

function setup() {
  const clock = createClipClock();
  const states: PlayerSnapshot[] = [];
  let pending: ((now: number) => void) | null = null;
  const frames = {
    request: (callback: (now: number) => void) => {
      pending = callback;
      return 1;
    },
    cancel: () => {
      pending = null;
    },
  };
  const control = createPlayerControl(clock, (snapshot) => states.push(snapshot), frames);
  control.configure({ length: 29_000, frameMs: 1000 / 30, spans });
  const video = new FakeVideo();
  control.attach(video);
  control.event('loadedmetadata');
  control.event('loadeddata');
  /** Runs the next animation frame at `now` ms. */
  const frame = (now: number) => {
    const run = pending;
    pending = null;
    run?.(now);
  };
  return { clock, control, video, frame, state: () => control.snapshot };
}

describe('the clip player', () => {
  it('plays, and the clock follows the video every frame', async () => {
    const { clock, control, video, frame, state } = setup();
    control.toggle();
    await Promise.resolve();
    control.event('play');
    expect(state()).toMatchObject({ playing: true, shuttle: 1 });
    video.advance(1.25);
    frame(16);
    expect(clock.get()).toBe(1250);
    control.toggle();
    expect(video.paused).toBe(true);
    expect(state()).toMatchObject({ playing: false, shuttle: 0 });
  });

  it('keeps only the newest seek while the video is still seeking', () => {
    const { clock, control, video } = setup();
    control.seek(1000);
    control.seek(2000);
    control.seek(3000);
    expect(clock.get()).toBe(3000);
    expect(video.seeks).toEqual([1]);
    video.seeking = false;
    control.event('seeked');
    expect(video.seeks).toEqual([1, 3]);
  });

  it('steps a frame at a time, landing in the middle of the frame, and stays inside the clip', () => {
    const { clock, control } = setup();
    control.stepFrame(1);
    expect(clock.get()).toBeCloseTo(50);
    control.stepFrame(1);
    expect(clock.get()).toBeCloseTo(83.33, 1);
    control.stepFrame(-1);
    control.stepFrame(-1);
    control.stepFrame(-1);
    expect(clock.get()).toBeCloseTo(16.67, 1);
    control.seek(29_000);
    control.stepFrame(1);
    expect(clock.get()).toBeLessThanOrEqual(29_000);
  });

  it('shuttles: L faster each time up to 4×, J backwards on the clock, K stops', async () => {
    const { clock, control, video, frame, state } = setup();
    control.shuttle(1);
    await Promise.resolve();
    expect(video.playbackRate).toBe(1);
    control.shuttle(1);
    control.shuttle(1);
    control.shuttle(1);
    expect(video.playbackRate).toBe(4);
    expect(state().shuttle).toBe(4);

    control.seek(10_000);
    control.shuttle(-1);
    expect(video.paused).toBe(true);
    expect(state()).toMatchObject({ playing: true, shuttle: -1 });
    frame(1000);
    frame(1500);
    expect(clock.get()).toBe(9500);
    control.shuttle(-1);
    frame(2000);
    expect(clock.get()).toBe(8500);
    control.pause();
    expect(state()).toMatchObject({ playing: false, shuttle: 0 });
  });

  it('pauses while the playhead is dragged and picks up where it is let go', async () => {
    const { clock, control, video } = setup();
    control.toggle();
    await Promise.resolve();
    control.event('play');
    control.grab();
    expect(video.paused).toBe(true);
    control.seek(12_000);
    control.release();
    expect(clock.get()).toBe(12_000);
    expect(video.paused).toBe(false);
  });

  it('loops the shot at the playhead: past its end, back to its start', async () => {
    const { clock, control, video, frame } = setup();
    control.seek(5000);
    control.toggleLoop();
    control.toggle();
    await Promise.resolve();
    control.event('play');
    // The second shot runs from 4 s to 11 s.
    video.advance(11.2 - video.currentTime);
    frame(16);
    expect(clock.get()).toBe(4000);
    expect(video.currentTime).toBe(4);
  });

  it('says when the video failed to load, and stops', () => {
    const { control, state } = setup();
    control.event('error');
    expect(state()).toMatchObject({ failed: true, ready: false, playing: false });
  });
});
