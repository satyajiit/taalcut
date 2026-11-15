// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a scene card's picture (TRIM1) · system: DESIGN.md v0.7 (Footage First)
 * the scene as it plays: the frame from the middle of the part of its clip the scene uses (the file's filmstrip,
 *   never decoded here), so a card whose part looks at the floor shows the floor, and shows the new part once
 *   one is picked. Until the filmstrip is there, and for a photo or a clip without one, the shot's own picture
 * states: the part's frame · the shot's picture (no filmstrip yet, or none) · nothing to draw (the viewer grey)
 * motion: none
 */
import { useMemo } from 'react';
import { frameTimesMs, nearestFrame, useSpriteLoad } from '../../library/clip/scrubber/sprite';
import type { ClipView, TimelineModel } from '../model';
import type { ShotLookup } from '../shot-frames';
import { coverStyle } from './cover-style';
import { msAt, partOf } from './part-model';

/** The card's picture box, width over height (`aspect-video`). */
const CARD_SHAPE = 16 / 9;

export function ScenePicture({
  clip,
  model,
  lookup,
  still,
}: {
  clip: ClipView;
  model: TimelineModel;
  /** Where the files' filmstrips are; without it the shot's picture stands. */
  lookup: ShotLookup | undefined;
  /** The shot's own picture. */
  still: string | null;
}) {
  const part = useMemo(() => partOf(clip, model), [clip, model]);
  const frames = part ? lookup?.strip(part.assetId) : undefined;
  const load = useSpriteLoad(frames?.src ?? null);
  const times = useMemo(() => (frames ? frameTimesMs(frames.filmstrip) : []), [frames]);
  if (part && frames && load === 'ready' && times.length > 0) {
    const index = nearestFrame(times, msAt(part, (part.from + part.to) / 2));
    return (
      <span
        data-slot="scene-frame"
        data-frame={index}
        className="block size-full"
        style={coverStyle(frames.filmstrip, frames.src, index, CARD_SHAPE)}
      />
    );
  }
  return still ? <img src={still} alt="" className="size-full object-cover" draggable={false} /> : null;
}
