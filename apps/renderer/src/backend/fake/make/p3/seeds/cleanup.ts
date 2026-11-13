// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The cleanup area's seeded project (P3-V9): a talking head, "Nani’s chai" (how a grandmother makes it): three long
 * takes from the camera, no music and no beats (speech sets the cuts), captions from what is said. Each take's
 * footage gets a speech analysis (cleanup/speech.ts), so planCleanup has fillers, long pauses, a retake and a
 * stressed word or two to work with. Seeded only when the cleanup area asks for it (options/cleanup.ts).
 */
import {
  RationalTime,
  type CaptionTrack,
  type Clip,
  type ProjectId,
  type SpeechCleanupAnalysis,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { fakeUlid } from '../../../library/seed';
import { cleanupArea } from '../cleanup/cleanup-area';
import { CAPTION_STYLE, CANVAS_RATE } from '../../build';
import { MAKE_KIND } from '../../ids';
import { FIXTURE_NOW } from '../../../library/assets';
import type { PoolShot } from '../../shot-pool';
import { registerSpeech, speechAnalysis } from '../cleanup/speech';
import type { Seeder, SeedTools } from './seeder';

export const TALKING_PROJECT = fakeUlid<'Project'>(MAKE_KIND.project, 60) as ProjectId;
export const TALKING_TIMELINE = fakeUlid<'Timeline'>(MAKE_KIND.timeline, 60) as TimelineId;

const TAKE_SECONDS = 18;
const TAKES = 3;
const SECONDS = (time: RationalTime) => RationalTime.toSeconds(time);

/** Long 30 fps takes nobody else's cut uses, so only this project has speech. */
function takes(tools: SeedTools): PoolShot[] {
  const elsewhere = new Set(
    [tools.pool(96, 1), tools.pool(80, 2), tools.pool(160, 3), tools.pool(60, 4)]
      .flat()
      .map((shot) => shot.candidate.assetId),
  );
  return tools
    .pool(240, 61)
    .filter((shot) => {
      const rate = shot.available.duration.rate;
      return (
        !elsewhere.has(shot.candidate.assetId) &&
        rate.num === 30 &&
        rate.den === 1 &&
        SECONDS(shot.available.duration) >= TAKE_SECONDS + 1
      );
    })
    .slice(0, TAKES);
}

/** Caption cues from the words each take says, four words a cue, in timeline frames. */
function captionsFrom(clips: readonly Clip[], speech: readonly SpeechCleanupAnalysis[]): CaptionTrack {
  const at = (frames: number) => RationalTime.of(Math.round(frames), CANVAS_RATE);
  const cues: CaptionTrack['cues'] = [];
  let offset = 0;
  clips.forEach((clip, index) => {
    const origin = SECONDS(clip.sourceStart);
    const end = clip.duration.value;
    const words = (speech[index]?.words ?? []).flatMap((word) => {
      const start = Math.round((SECONDS(word.range.start) - origin) * 30);
      const stop = Math.max(
        start + 1,
        Math.round((SECONDS(word.range.start) + SECONDS(word.range.duration) - origin) * 30),
      );
      return start >= 0 && stop <= end ? [{ text: word.text, start, stop }] : [];
    });
    for (let first = 0; first < words.length; first += 4) {
      const group = words.slice(first, first + 4);
      const head = group[0];
      const tail = group.at(-1);
      if (!head || !tail) continue;
      cues.push({
        id: fakeUlid<'CaptionCue'>(MAKE_KIND.cue, 6000 + cues.length),
        range: { start: at(offset + head.start), duration: at(tail.stop - head.start) },
        words: group.map((word) => ({
          text: word.text,
          range: { start: at(offset + word.start), duration: at(word.stop - word.start) },
          confidence: 0.95,
        })),
        edited: false,
      });
    }
    offset += end;
  });
  return { enabled: true, language: 'en', style: CAPTION_STYLE, styleSource: 'reference', cues };
}

function talkingHead(tools: SeedTools, pool: readonly PoolShot[]): Timeline {
  const built = tools.build({
    id: TALKING_TIMELINE,
    n: 60,
    projectId: TALKING_PROJECT,
    name: 'Nani’s chai',
    template: null,
    beatMap: null,
    slots: pool.map(() => ({ slotId: null, frames: TAKE_SECONDS * 30, beatIndex: null })),
    pool,
    variantIndex: 0,
    variantCount: 1,
    castId: null,
    mode: 'story',
    text: [],
    captions: [],
    language: 'en',
    unsure: [],
    createdAt: FIXTURE_NOW - 2 * 3_600_000,
  });
  // Each take from its start, sound on: the camera's own audio is the film.
  const clips = built.tracks[0]?.kind === 'video' ? built.tracks[0].items : [];
  const takesOnly = clips.flatMap((item) =>
    item.type === 'clip' && item.media.kind === 'video'
      ? [{ ...item, sourceStart: item.media.available.start, audio: { gainDb: 0, muted: false } }]
      : [],
  );
  const speech = takesOnly.map((clip, index) =>
    speechAnalysis(
      clip.media.assetId,
      SECONDS(clip.media.kind === 'video' ? clip.media.available.duration : clip.duration),
      60 + index,
    ),
  );
  speech.forEach(registerSpeech);
  return {
    ...built,
    tracks: built.tracks.map((track, index) =>
      index === 0 && track.kind === 'video' ? { ...track, items: takesOnly } : track,
    ),
    captions: captionsFrom(takesOnly, speech),
  };
}

/** The cleanup area's seeded projects (Phase 3), joined to the Make fakes' seed. */
export const seedCleanup: Seeder = (tools) => {
  if (!cleanupArea(tools.areas).talkingHead) return [];
  const pool = takes(tools);
  if (pool.length < TAKES) return [];
  return [
    {
      id: TALKING_PROJECT,
      name: 'Nani’s chai',
      createdAt: FIXTURE_NOW - 2 * 3_600_000,
      archivedAt: null,
      timelines: [talkingHead(tools, pool)],
    },
  ];
};
