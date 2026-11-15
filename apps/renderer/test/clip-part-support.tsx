// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1's tests share this: the seeded timeline with one scene playing a known part of a known file (ten seconds
 * at 30 frames a second, in two shots: the first four seconds, then the last six), the file's detail as the fake
 * library would give it, a strip whose pixels are the file's frames, and edits whose commands are checked against
 * the same contract the command queue admits.
 */
import {
  EDITOR_COMMANDS,
  editorCommandPayloads,
  ok,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  type AssetDetail,
  type AssetId,
  type Clip,
  type ShotId,
  type Timeline,
} from '@taalcut/core';
import { vi } from 'vitest';
import { DEFAULT_ASSET_COUNT, fakeAsset, fakeSources, KIND } from '../src/backend/fake/library/assets';
import { fakeAssetDetail } from '../src/backend/fake/library/detail';
import { fakeUlid } from '../src/backend/fake/library/seed';
import { buildModel } from '../src/features/timeline/model';
import type { ShotLookup, ShotStrip } from '../src/features/timeline/shot-frames';
import type { Edits } from '../src/features/timeline/use-edits';
import { fakeLookup, stripOf } from './other-shots-support';
import { editorFixture } from './simple-editor-support';

export const FILE = fakeUlid<'Asset'>(KIND.asset, 77_001) as AssetId;
export const SHOT_A = fakeUlid<'Shot'>(KIND.shot, 77_001 * 16) as ShotId;
export const SHOT_B = fakeUlid<'Shot'>(KIND.shot, 77_001 * 16 + 1) as ShotId;
/** The file's rate and length: ten seconds, so a strip 300 px wide has a frame a pixel. */
export const RATE = { num: 30, den: 1 } as const;
export const FILE_FRAMES = 300;
/** Where the first shot ends and the second begins. */
export const CUT = 120;

const at = (value: number) => ({ value, rate: { ...RATE } });

/** The file's detail: a generated clip's, with this file's id, length and two shots. */
export function fileDetail(patch: Partial<AssetDetail['asset']> = {}): AssetDetail {
  const sources = fakeSources();
  const base = fakeAssetDetail(fakeAsset(3, DEFAULT_ASSET_COUNT, sources), sources[0]!);
  const shot = base.shots[0]!;
  return {
    ...base,
    asset: { ...base.asset, id: FILE, duration: at(FILE_FRAMES), availability: 'online', ...patch },
    filmstrip: null,
    playback: null,
    shots: [
      { ...shot, id: SHOT_A, index: 0, range: { start: at(0), duration: at(CUT) } },
      { ...shot, id: SHOT_B, index: 1, range: { start: at(CUT), duration: at(FILE_FRAMES - CUT) } },
    ],
  };
}

export interface PartFixtureOptions {
  /** Which scene plays the file: 0 is the video's first. The third by default (a scene on each side). */
  index?: number;
  /** The part's first frame in the file. Frame 30 (one second in) by default. */
  from?: number;
  /** The scene's length in canvas frames. One second by default. */
  frames?: number;
  /** Keep the timeline's beat map (ends then land on beats). Off by default: any frame. */
  beats?: boolean;
  patch?: (clip: Clip) => Clip;
}

/** The seeded timeline with scene `index` playing `frames` of the file from frame `from`, in its first shot. */
export function partTimeline(base: Timeline, options: PartFixtureOptions = {}): Timeline {
  const { index = 2, from = 30, beats = false } = options;
  let scene = -1;
  return {
    ...base,
    beatMap: beats ? base.beatMap : null,
    tracks: base.tracks.map((track, trackIndex) =>
      trackIndex !== 0 || track.kind !== 'video'
        ? track
        : {
            ...track,
            items: track.items.map((item) => {
              if (item.type !== 'clip') return item;
              scene += 1;
              if (scene !== index) return item;
              const clip: Clip = {
                ...item,
                media: {
                  kind: 'video',
                  assetId: FILE,
                  shotId: SHOT_A,
                  available: { start: at(0), duration: at(FILE_FRAMES) },
                },
                sourceStart: at(from),
                duration: { value: options.frames ?? 30, rate: base.canvas.rate },
                speed: null,
                locked: false,
              };
              // A held moment has no part: this scene plays its clip.
              delete clip.holdFrame;
              return options.patch ? options.patch(clip) : clip;
            }),
          },
    ),
  };
}

export function partFixture(options: PartFixtureOptions = {}) {
  const f = editorFixture();
  const timeline = partTimeline(f.timeline, options);
  const model = buildModel(timeline, null);
  const clip = model.clips[options.index ?? 2]!;
  // Commands as the queue admits them: a payload the contract refuses fails the test.
  const command = vi.fn<Edits['command']>(async (name, payload) => {
    const schema =
      name === EDITOR_COMMANDS.slipClip
        ? editorCommandPayloads[EDITOR_COMMANDS.slipClip]
        : name === TIMELINE_COMMANDS.swapClip
          ? timelineCommandPayloads[TIMELINE_COMMANDS.swapClip]
          : null;
    if (!schema) throw new Error(`an unexpected command: ${name}`);
    schema.parse({
      projectId: timeline.projectId,
      timelineId: timeline.id,
      revision: timeline.revision,
      ...payload,
    });
    return ok({});
  });
  const edits: Edits = { ...f.edits, command };
  return { ...f, timeline, model, clip, edits, command };
}

/**
 * A lookup that has the file's detail, and (asked for) its filmstrip and its copy to play. `detail: null` is a
 * file that can't be read; `detail: 'loading'` one whose detail never arrives.
 */
export function fileLookup(
  parts: { detail?: AssetDetail | null | 'loading'; strip?: ShotStrip | number; playback?: string } = {},
): ShotLookup {
  const detail = parts.detail === undefined ? fileDetail() : parts.detail;
  const strip = typeof parts.strip === 'number' ? stripOf(parts.strip) : parts.strip;
  const lookup = fakeLookup({
    ...(detail && detail !== 'loading' ? { details: new Map([[FILE, detail]]) } : {}),
    ...(strip ? { strips: new Map([[FILE, strip]]) } : {}),
    ...(parts.playback ? { playbacks: new Map([[FILE, parts.playback]]) } : {}),
  });
  return detail === 'loading' ? { ...lookup, detail: () => new Promise(() => undefined) } : lookup;
}

/** jsdom lays nothing out: the strip is 300 px wide from x = 0, so a pixel along it is a frame of the file. */
export function layOutStrip(strip: Element, width = FILE_FRAMES): void {
  strip.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: width,
      bottom: 56,
      width,
      height: 56,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}
