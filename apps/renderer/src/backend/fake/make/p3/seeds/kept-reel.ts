// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: the video made from the kept-reel template (templates/template-kept-reel.ts), as assembly leaves it
 * (packages/timeline assembly/reel-footage.ts). Three clips: the first is the person's own, cast from the library;
 * the other two are the reel's own footage, each an ordinary video clip on V1 whose media is the template's reel (one
 * asset, which no list of the library shows), from the slot's start for the slot's length, whole in the frame
 * (`contain`, no reframe) and muted, with the reel's own music carrying its sound. In the cast those two are
 * `reelKept`: the reel as the pick, no confidence, no other shots. Its chat is chat/fake-seed-kept-reel.ts. Seeded
 * only when asked for (options/kept-reel.ts), so the specs that count the seeded projects keep their numbers.
 */
import {
  RationalTime,
  TimeRange,
  type AssetId,
  type CastId,
  type ConversationId,
  type ProjectId,
  type Template,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { FIXTURE_NOW, KIND } from '../../../library/assets';
import { fakeUlid } from '../../../library/seed';
import { keptReelTemplate } from '../../../templates/template-kept-reel';
import { MAKE_KIND } from '../../ids';
import type { Seeder } from './seeder';

export const KEPT_REEL_PROJECT = fakeUlid<'Project'>(MAKE_KIND.project, 80) as ProjectId;
export const KEPT_REEL_TIMELINE = fakeUlid<'Timeline'>(MAKE_KIND.timeline, 80) as TimelineId;
export const KEPT_REEL_CAST = fakeUlid<'Cast'>(MAKE_KIND.cast, 80) as CastId;
/** The project's chat: the run that read the reel and made the video. */
export const KEPT_REEL_CONVERSATION = fakeUlid<'Conversation'>(MAKE_KIND.conversation, 80) as ConversationId;
/** The template's kept reel as the one library asset its kept clips play: beyond every clip the fake library seeds. */
export const KEPT_REEL_ASSET = fakeUlid<'Asset'>(KIND.asset, 9_000_009) as AssetId;

const HOUR = 3_600_000;

/** `areas.keptReel` as the seed reads it. */
export const keptReelSeeded = (areas: Readonly<Record<string, unknown>> | undefined): boolean =>
  areas?.keptReel === true;

/** The built video with each slot that keeps the reel's footage filled from the reel, in the clips and the cast. */
export function withReelKept(built: Timeline, template: Template, reel: AssetId): Timeline {
  if (!built.cast) return built;
  const rate = template.canvas.rate;
  const kept = new Map(
    template.slots.flatMap((slot) => (slot.footage?.from === 'reel' ? [[slot.id, slot] as const] : [])),
  );
  const available = TimeRange.of(RationalTime.zero(rate), template.duration);
  return {
    ...built,
    music: { path: 'referenceAudio', templateId: template.id, gainDb: 0 },
    tracks: built.tracks.map((track) =>
      track.id !== 'V1' || track.kind === 'text'
        ? track
        : {
            ...track,
            items: track.items.map((item) => {
              const slot = item.type === 'clip' && item.slotId ? kept.get(item.slotId) : undefined;
              if (!slot || item.type !== 'clip') return item;
              return {
                ...item,
                media: { kind: 'video' as const, assetId: reel, shotId: null, available },
                sourceStart: slot.start,
                speed: null,
                syncPoint: null,
                fit: 'contain' as const,
                audio: { gainDb: 0, muted: true },
                locked: false,
                reframe: null,
              };
            }),
          },
    ),
    cast: {
      ...built.cast,
      slots: built.cast.slots.map((cast) => {
        const slot = kept.get(cast.slotId);
        if (!slot) return cast;
        return {
          ...cast,
          pick: {
            assetId: reel,
            shotId: null,
            sourceStart: slot.start,
            syncPoint: null,
            score: 0,
            parts: {
              intent: 0,
              motion: 0,
              quality: 0,
              subject: 0,
              energy: 0,
              hook: null,
              rerank: null,
              penalty: 0,
            },
          },
          alternates: [],
          confidence: null,
          needsRerank: false,
          note: 'reelKept' as const,
        };
      }),
    },
  };
}

export const seedKeptReel: Seeder = (tools) => {
  if (!keptReelSeeded(tools.areas)) return [];
  const template = keptReelTemplate();
  const createdAt = FIXTURE_NOW - 2 * HOUR;
  const built = tools.build({
    id: KEPT_REEL_TIMELINE,
    n: 80,
    projectId: KEPT_REEL_PROJECT,
    name: 'My morning, then the scene',
    template: { id: template.id, version: template.version },
    beatMap: template.beatMap,
    slots: template.slots.map((slot) => ({
      slotId: slot.id,
      frames: slot.duration.value,
      beatIndex: slot.beatAnchor?.beatIndex ?? null,
    })),
    pool: tools.pool(24, 80),
    variantIndex: 0,
    variantCount: 1,
    castId: KEPT_REEL_CAST,
    mode: 'template',
    text: [],
    captions: [],
    language: 'en',
    unsure: [],
    createdAt,
  });
  return [
    {
      id: KEPT_REEL_PROJECT,
      name: 'My morning, then the scene',
      createdAt,
      archivedAt: null,
      timelines: [withReelKept(built, template, KEPT_REEL_ASSET)],
      conversationId: KEPT_REEL_CONVERSATION,
    },
  ];
};
