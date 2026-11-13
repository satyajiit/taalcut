// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a composition's stills are drawn over (HFW1 frames): grey, a given picture (the reel's frame), or the
 * footage of a timeline at the moment the composition would play there. One timeline of image clips carries them:
 * the composition starts at frame 0 and plays at 30 fps, and the clip under each still's frame is that moment's
 * picture, so one capture session draws every still. Footage is the picture of the visual on screen then (the
 * timeline's own captions and other graphics are not drawn under the stills).
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_MIX,
  FrameRate,
  newId,
  ok,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  timelineSchema,
  type AsyncResult,
  type Timeline,
  type WorkspaceFramesInput,
} from '@taalcut/core';
import type { RenderEngineDeps } from '../../engine/deps';
import { playableFile } from '../../engine/playable-file';
import { extractStill, stillSeconds } from '../../engine/stills';
import { neutralPng } from './still';
import { planTimeline } from '../../plan/render-plan';

/** The composition's own rate in the stills' timeline. */
export const FRAMES_RATE = FrameRate.of(30);

export interface Picture {
  readonly file: string;
  readonly ext: 'png' | 'jpg';
}

/** Frame `frame` (of the stills' timeline) shows `picture` from there on. */
export interface Backdrop {
  readonly frame: number;
  readonly picture: Picture;
}

type Over = WorkspaceFramesInput['over'];

/** The pictures under the stills, one per distinct still frame. */
export async function backdropsFor(
  deps: Pick<RenderEngineDeps, 'timelines' | 'assets' | 'media'>,
  over: Over,
  frames: readonly number[],
  dir: string,
  signal?: AbortSignal,
): AsyncResult<Backdrop[]> {
  const distinct = [...new Set(frames)].sort((a, b) => a - b);
  if (over.kind === 'grey' || over.kind === 'image') {
    const picture: Picture =
      over.kind === 'grey'
        ? { file: join(dir, 'grey.png'), ext: 'png' }
        : {
            file: join(dir, over.mimeType === 'image/png' ? 'over.png' : 'over.jpg'),
            ext: over.mimeType === 'image/png' ? 'png' : 'jpg',
          };
    await writeFile(
      picture.file,
      over.kind === 'grey' ? neutralPng() : Buffer.from(over.dataBase64, 'base64'),
    );
    return ok([{ frame: 0, picture }]);
  }
  const timeline = await deps.timelines.get(over.timelineId as Timeline['id']);
  if (!timeline.ok) return timeline;
  const plan = planTimeline(timeline.value);
  if (!plan.ok) return plan;
  const grey = { file: join(dir, 'grey.png'), ext: 'png' as const };
  await writeFile(grey.file, neutralPng());
  const backdrops: Backdrop[] = [];
  for (const frame of distinct) {
    const seconds = over.start + frame / 30;
    const at = Math.round((seconds * plan.value.rate.num) / plan.value.rate.den);
    const visual = plan.value.visuals.find(
      (candidate) => candidate.enabled && candidate.visible.start <= at && at < candidate.visible.end,
    );
    const source = visual ? await playableFile(deps.assets, visual.assetId, visual.kind === 'video') : null;
    if (!visual || !source) {
      backdrops.push({ frame, picture: grey });
      continue;
    }
    const file = join(dir, `footage-${frame}.jpg`);
    const time = visual.kind === 'image' ? null : stillSeconds(visual, at, plan.value.rate);
    const extracted = await extractStill(deps.media, source, time, file, signal);
    backdrops.push({ frame, picture: extracted.ok ? { file, ext: 'jpg' } : grey });
  }
  return ok(backdrops);
}

/** The stills' timeline: image clips under the frames, `frames` long, at 30 fps on a 1080×1920 canvas. */
export function sceneTimeline(
  backdrops: readonly Backdrop[],
  frames: number,
): { timeline: Timeline; pictures: Map<string, Picture> } {
  const rate = FRAMES_RATE;
  const pictures = new Map<string, Picture>();
  const items = backdrops.map((backdrop, index) => {
    const start = index === 0 ? 0 : backdrop.frame;
    const end = index === backdrops.length - 1 ? frames : (backdrops[index + 1]?.frame ?? frames);
    const id = newId<'TimelineItem'>();
    pictures.set(id, backdrop.picture);
    return {
      type: 'clip',
      id,
      media: { kind: 'image', assetId: newId<'Asset'>() },
      sourceStart: RationalTime.zero(rate),
      duration: RationalTime.of(Math.max(1, end - start), rate),
      speed: null,
      slotId: null,
      syncPoint: null,
      beatAnchor: null,
      fit: 'cover',
      audio: { gainDb: 0, muted: true },
      locked: false,
      enabled: true,
      stillMotion: null,
      reframe: null,
    };
  });
  const timeline = timelineSchema.parse({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Workspace frames',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate },
    template: null,
    beatMap: null,
    tracks: [{ kind: 'video', id: 'V1', name: 'Video', enabled: true, items }],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 0,
    updatedAt: 0,
  });
  // Clips follow each other: the visual ids are the items' ids, the pictures keyed by them.
  return { timeline, pictures };
}
