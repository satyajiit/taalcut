// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT2's tests share this: the seeded template timeline with scores that say which other shot is best, a shot
 * lookup that names files without a backend, pointer events as the browser sends them, and an editor's lower
 * area whose swap lands as the timeline command's does (the old pick joins the others, the new one leaves them).
 */
import type { AssetDetail, AssetId, CastCandidate, Filmstrip, Timeline, TimelineItemId } from '@taalcut/core';
import { fireEvent } from '@testing-library/react';
import { useMemo, useState, type ReactNode } from 'react';
import { buildModel, type TimelineModel } from '../src/features/timeline/model';
import { OtherShots } from '../src/features/timeline/other-shots/other-shots';
import type { ShotLookup, ShotStrip } from '../src/features/timeline/shot-frames';
import type { Edits } from '../src/features/timeline/use-edits';
import { editorFixture } from './simple-editor-support';

/** The other shots' scores for every slot, worst first, so "best first" is a change of order. */
export const SCORES = [0.2, 0.9, 0.5] as const;

/** The seeded timeline, its other shots scored `SCORES` in stored order. */
export function castFixture() {
  const fixture = editorFixture();
  const timeline: Timeline = {
    ...fixture.timeline,
    cast: fixture.timeline.cast && {
      ...fixture.timeline.cast,
      slots: fixture.timeline.cast.slots.map((slot) => ({
        ...slot,
        alternates: slot.alternates.map((alternate, index) => ({ ...alternate, score: SCORES[index] ?? 0 })),
      })),
    },
  };
  return { ...fixture, timeline, model: buildModel(timeline, null) };
}

/** A file's name as the fake lookup gives it: the end of its shot's id. */
export const nameOf = (candidate: Pick<CastCandidate, 'assetId' | 'shotId'>) =>
  `${(candidate.shotId ?? candidate.assetId).slice(-5)}.mov`;

export function fakeLookup(
  parts: {
    details?: ReadonlyMap<AssetId, AssetDetail>;
    strips?: ReadonlyMap<AssetId, ShotStrip>;
    playbacks?: ReadonlyMap<AssetId, string>;
  } = {},
): ShotLookup {
  return {
    detail: async (assetId) => parts.details?.get(assetId) ?? null,
    loaded: (assetId) => parts.details?.get(assetId),
    frame: async () => undefined,
    frameNow: (assetId, shotId) => ({
      url: null,
      name: nameOf({ assetId, shotId }),
      description: null,
      duration: null,
    }),
    strip: (assetId) => parts.strips?.get(assetId),
    playback: (assetId) => parts.playbacks?.get(assetId),
  };
}

/** A filmstrip of `count` frames a second apart, in one row. */
export function stripOf(count: number): ShotStrip {
  const filmstrip = {
    columns: count,
    rows: 1,
    tileWidth: 90,
    tileHeight: 160,
    times: Array.from({ length: count }, (_, index) => ({ value: index, rate: { num: 1, den: 1 } })),
  } as unknown as Filmstrip;
  return { filmstrip, src: 'sprite.jpg' };
}

/** jsdom loads no pictures: with this, every sprite has loaded as soon as it is asked for. */
export class LoadedImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_src: string) {
    queueMicrotask(() => this.onload?.());
  }
}

/**
 * The seeded timeline with scene 1 three seconds long, and its best other shot starting four seconds into a file
 * that has a twelve-frame filmstrip: frames 4 to 7 are the stretch the scene would play.
 */
export function filmstripFixture() {
  const f = castFixture();
  const clip = f.model.clips[0]!;
  const frames = 3 * (f.model.rate.num / f.model.rate.den);
  const best = [...clip.cast!.alternates].sort((a, b) => b.score - a.score)[0]!;
  const timeline: Timeline = {
    ...f.timeline,
    tracks: f.timeline.tracks.map((track) =>
      track.kind !== 'video'
        ? track
        : {
            ...track,
            items: track.items.map((item, index) =>
              index === 0 && item.type === 'clip'
                ? { ...item, duration: { value: frames, rate: f.model.rate } }
                : item,
            ),
          },
    ),
    cast: f.timeline.cast && {
      ...f.timeline.cast,
      slots: f.timeline.cast.slots.map((slot, index) =>
        index !== 0
          ? slot
          : {
              ...slot,
              alternates: slot.alternates.map((alternate) =>
                alternate === best
                  ? { ...alternate, sourceStart: { value: 4, rate: { num: 1, den: 1 } } }
                  : alternate,
              ),
            },
      ),
    },
  };
  const lookup = fakeLookup({ strips: new Map<AssetId, ShotStrip>([[best.assetId, stripOf(12)]]) });
  return { ...f, timeline, lookup };
}

/** The timeline after timeline.swapClip put `candidate` in `clipId`, as the timeline package leaves the cast. */
export function swapped(timeline: Timeline, clipId: TimelineItemId, candidate: CastCandidate): Timeline {
  return {
    ...timeline,
    revision: timeline.revision + 1,
    tracks: timeline.tracks.map((track) =>
      track.kind !== 'video'
        ? track
        : {
            ...track,
            items: track.items.map((item) =>
              item.type === 'clip' && item.id === clipId && item.media.kind === 'video' && candidate.shotId
                ? {
                    ...item,
                    media: { ...item.media, assetId: candidate.assetId, shotId: candidate.shotId },
                    sourceStart: candidate.sourceStart,
                  }
                : item,
            ),
          },
    ),
    cast: timeline.cast && {
      ...timeline.cast,
      slots: timeline.cast.slots.map((slot) =>
        slot.clipId !== clipId
          ? slot
          : {
              ...slot,
              pick: candidate,
              alternates: [...(slot.pick ? [slot.pick] : []), ...slot.alternates]
                .filter((other) => other.shotId !== candidate.shotId)
                .slice(0, 3),
              confidence: null,
              note: 'userPick' as const,
            },
      ),
    },
  };
}

/** The editor's lower area around `children(model)`: a swap that goes through moves the timeline on. */
export function ShotsHarness({
  timeline: initial,
  edits,
  lookup,
  paused = false,
  children,
}: {
  timeline: Timeline;
  edits: Edits;
  lookup: ShotLookup;
  paused?: boolean;
  children: (model: TimelineModel, edits: Edits) => ReactNode;
}) {
  const [timeline, setTimeline] = useState(initial);
  const model = useMemo(() => buildModel(timeline, null), [timeline]);
  const live: Edits = {
    ...edits,
    swap: async (clipId, candidate, from) => {
      const result = await edits.swap(clipId, candidate, from);
      if (result.ok) setTimeline((now) => swapped(now, clipId, candidate));
      return result;
    },
  };
  return (
    <OtherShots model={model} edits={live} lookup={lookup} paused={paused}>
      {children(model, live)}
    </OtherShots>
  );
}

/** A pointer event as Chromium sends it: `held` is the buttons down (1: the main button). */
export function pointer(
  target: Element,
  type: 'pointermove' | 'pointerdown' | 'pointerup' | 'pointerover' | 'pointerout',
  at: { x?: number; y?: number; held?: number; to?: Element | null } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: at.x ?? 10,
    clientY: at.y ?? 10,
    button: 0,
    buttons: at.held ?? 0,
    relatedTarget: at.to ?? null,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  fireEvent(target, event);
}
