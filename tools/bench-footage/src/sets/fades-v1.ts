// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `fades-v1` (IX3-D1): fades through black and the pictures that look like them, labelled to the frame, for the
 * shot eval. ix-v1 has none (its transitions are hard cuts and dissolves). Five scripted 720p H.264 clips (OpenH264:
 * nothing here tests the hardware encoder), at 30 and 60 fps, room tone only:
 * - fade out, black held 0 to 1 s, fade in: at 0.25, 0.5 and 1 s a side;
 * - slow fades (1.5 and 2 s a side) that touch black for a frame or two, with no hold;
 * - a cut to black and back (1 and 0.6 s of black, no fade: two cuts), a cut to black that fades in, and a fade
 *   out that cuts in from black;
 * - low-key shots (night footage) whose level drifts in and out of blackdetect's black: no boundary inside, and
 *   one entered by a dissolve;
 * with hard cuts and dissolves between them, so the cuts' scores stay honest on the same clips.
 */
import type { ClipSpec, FootageSet, ScriptedShot } from './types';

const fade = (out: number, hold: number, into: number): ScriptedShot['entry'] => ({
  kind: 'fade',
  out,
  hold,
  in: into,
});
const dissolve = (seconds: number): ScriptedShot['entry'] => ({ kind: 'dissolve', seconds });

const clip = (file: string, fps: 30 | 60, script: readonly ScriptedShot[], seconds: number, at: string) =>
  ({
    file,
    width: 1280,
    height: 720,
    fps,
    codec: 'h264',
    bitrate: '8M',
    seconds,
    speech: null,
    bed: 'room',
    createdAt: at,
    onScreen: [],
    bars: false,
    script,
  }) satisfies ClipSpec;

export const FADES_V1: FootageSet = {
  name: 'fades-v1',
  version: 1,
  seed: 20_261_020,
  looksProbe: 'zooming fractal',
  clips: [
    clip(
      'fades-hold-30.mp4',
      30,
      [
        { look: 'pattern', seconds: 4 },
        { look: 'fractal', seconds: 5, entry: fade(0.5, 0.5, 0.5) },
        { look: 'gradient', seconds: 4 },
        { look: 'life', seconds: 5, entry: fade(1, 1, 1) },
        { look: 'pan', seconds: 5, entry: dissolve(1) },
        { look: 'zoom', seconds: 4, entry: fade(0.5, 0, 0.5) },
      ],
      27.5,
      '2026-10-02T18:10:00Z',
    ),
    clip(
      'fades-hold-60.mp4',
      60,
      [
        { look: 'fractal', seconds: 5 },
        { look: 'pattern', seconds: 5, entry: fade(0.5, 1, 0.5) },
        { look: 'cells', seconds: 4 },
        { look: 'zoom', seconds: 5, entry: fade(0.25, 0.25, 0.25) },
        { look: 'gradient', seconds: 5, entry: fade(0.5, 0, 0.5) },
      ],
      25.25,
      '2026-10-02T18:20:00Z',
    ),
    clip(
      'fades-slow-30.mp4',
      30,
      [
        { look: 'gradient', seconds: 6 },
        { look: 'pan', seconds: 6, entry: fade(2, 0, 2) },
        { look: 'life', seconds: 4 },
        { look: 'fractal', seconds: 6, entry: fade(1.5, 0, 1.5) },
        { look: 'pattern', seconds: 4, entry: dissolve(0.5) },
      ],
      25.5,
      '2026-10-02T18:30:00Z',
    ),
    clip(
      'black-cuts-30.mp4',
      30,
      [
        { look: 'pattern', seconds: 4 },
        { look: 'fractal', seconds: 4, entry: fade(0, 1, 0) },
        { look: 'gradient', seconds: 4, entry: fade(0, 0.6, 0) },
        { look: 'zoom', seconds: 5, entry: fade(0, 1, 1) },
        { look: 'cells', seconds: 4, entry: fade(1, 0.8, 0) },
      ],
      24.4,
      '2026-10-02T18:40:00Z',
    ),
    clip(
      'dark-30.mp4',
      30,
      [
        { look: 'pan', seconds: 4 },
        { look: 'fractal', seconds: 8, dark: true },
        { look: 'pattern', seconds: 4 },
        { look: 'gradient', seconds: 6, dark: true, entry: dissolve(1) },
        { look: 'life', seconds: 4 },
      ],
      25,
      '2026-10-02T18:50:00Z',
    ),
  ],
};
