// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A labelled clip's boundaries on its frame grid. A hard cut is the frame the new shot starts on,
 * `round(at × fps)`; the generator trims each shot to whole frames, so a cut can land one frame later than
 * that (a shot of 4.4 s at 30 fps started at frame 133 on ix-v1), which the eval's ±1 frame covers. A
 * dissolve is the frames it blends, `[round(at × fps), round((at + seconds) × fps)]`; a fade through black
 * (IX3-D3) the same way, its frames from the fade out's first to the fade in's last.
 */
import type { LabelledClip } from './schema';

export interface FrameSpan {
  readonly from: number;
  readonly to: number;
}

export interface ClipTruth {
  readonly file: string;
  readonly fps: number;
  readonly frames: number;
  readonly cuts: readonly number[];
  readonly dissolves: readonly FrameSpan[];
  readonly fades: readonly FrameSpan[];
}

export function clipTruth(clip: LabelledClip): ClipTruth {
  const frame = (seconds: number) => Math.round(seconds * clip.fps);
  const cuts: number[] = [];
  const spans: Record<'dissolve' | 'fade', FrameSpan[]> = { dissolve: [], fade: [] };
  for (const cut of clip.cuts) {
    if (cut.kind === 'cut') cuts.push(frame(cut.at));
    else
      spans[cut.kind].push({ from: frame(cut.at), to: Math.max(frame(cut.at), frame(cut.at + cut.seconds)) });
  }
  const byStart = (a: FrameSpan, b: FrameSpan) => a.from - b.from;
  return {
    file: clip.file,
    fps: clip.fps,
    frames: frame(clip.seconds),
    cuts: cuts.sort((a, b) => a - b),
    dissolves: spans.dissolve.sort(byStart),
    fades: spans.fade.sort(byStart),
  };
}
