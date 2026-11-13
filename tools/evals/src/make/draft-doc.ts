// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: a case's first draft as a timeline, as a cast and assembly leave it: one clip per slot from the case's
 * picks with the cast's alternates on record, and a chat-bubble graphic per reel bubble the draft draws (drawn where
 * the case says, its words the reel's). Every id fixed, so a run reads the same.
 */
import { createHash } from 'node:crypto';
import {
  DEFAULT_MIX,
  graphicCompositionSchema,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  TimeRange,
  timelineSchema,
  type CastCandidate,
  type Clip,
  type GraphicItem,
  type ProjectId,
  type Template,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { fixedId } from '../edit/ids';
import type { MakeCase } from './cases';
import { FPS, MEDIA_FRAMES, shotByKey } from './footage';

export const MAKE_PROJECT_ID = fixedId<'Project'>('01K9MJ', 1);
export const MAKE_TIMELINE_ID = fixedId<'Timeline'>('01K9MM', 1);

const at = (frames: number) => RationalTime.of(frames, FPS);
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const HTML = '<div data-composition-id="bubble"><p data-var-text="text"></p></div>';

/** A made-up chat bubble composition: the draft's graphics draw with it (the eval never draws it). */
export const BUBBLE = graphicCompositionSchema.parse({
  id: fixedId<'GraphicComposition'>('01K9MC', 1),
  version: 1,
  hash: sha(HTML),
  name: 'Chat bubble',
  entry: 'index.html',
  files: [{ path: 'index.html', sha256: sha(HTML), bytes: Buffer.byteLength(HTML) }],
  variables: [{ type: 'text', name: 'text', maxLength: 80, sample: 'A message' }],
  durationSeconds: 2,
  provenance: { model: null, overlays: [], brief: null, createdAt: 0 },
  gate: {
    version: 'hfw1.1',
    passed: true,
    checkedAt: 0,
    hfLint: { errors: 0, warnings: 0 },
    checks: [],
    loweredTweens: 0,
  },
});

const candidate = (key: string, from: number, score: number): CastCandidate => {
  const shot = shotByKey(key);
  return {
    assetId: shot.assetId,
    shotId: shot.shotId,
    sourceStart: at(Math.round(from * 30)),
    syncPoint: null,
    score,
    parts: {
      intent: 0.6,
      motion: 0.5,
      quality: 0.8,
      subject: 0.5,
      energy: 0.6,
      hook: null,
      rerank: null,
      penalty: 0,
    },
  };
};

export function draftTimeline(
  made: MakeCase,
  template: Template,
  projectId: ProjectId = MAKE_PROJECT_ID,
  id: TimelineId = MAKE_TIMELINE_ID,
): Timeline {
  const clips: Clip[] = template.slots.map((slot, index) => {
    const pick = made.picks[index]!;
    const shot = shotByKey(pick.shot);
    const from = Math.round(pick.from * 30);
    return {
      type: 'clip',
      id: fixedId<'TimelineItem'>('01K9MV', index + 1),
      media: {
        kind: 'video',
        assetId: shot.assetId,
        shotId: shot.shotId,
        available: TimeRange.of(at(0), at(MEDIA_FRAMES)),
      },
      sourceStart: at(from),
      duration: slot.duration,
      speed: null,
      slotId: slot.id,
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
  const graphics: GraphicItem[] = template.text.flatMap((overlay, index): GraphicItem[] => {
    const box = made.drawn[index];
    if (!box) return [];
    return [
      {
        type: 'graphic',
        id: fixedId<'TimelineItem'>('01K9MG', index + 1),
        anchor: { kind: 'time', at: overlay.start },
        start: overlay.start,
        duration: overlay.duration,
        placement: { box },
        styleKey: 'graphic',
        language: 'en',
        origin: 'agent',
        overlay: { id: overlay.id, words: 'template' },
        composition: { id: BUBBLE.id, hash: BUBBLE.hash, params: { text: overlay.text } },
      },
    ];
  });
  return timelineSchema.parse({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id,
    projectId,
    name: `Made like ${made.id}`,
    revision: 1,
    canvas: { width: 1080, height: 1920, rate: FPS },
    template: { id: template.id, version: template.version },
    beatMap: null,
    tracks: [
      { kind: 'video', id: 'V1', name: 'V1', enabled: true, items: clips },
      { kind: 'text', id: 'T1', name: 'Graphics', enabled: true, items: graphics },
    ],
    markers: [],
    cast: {
      castId: fixedId<'Cast'>('01K9MK', 1),
      mode: 'template',
      variantIndex: 0,
      variantCount: 1,
      configVersion: 'casting.v5',
      sequenceConfidence: 0.6,
      slots: template.slots.map((slot, index) => ({
        slotId: slot.id,
        clipId: clips[index]!.id,
        pick: candidate(made.picks[index]!.shot, made.picks[index]!.from, 0.6),
        alternates: (made.alternates[index] ?? []).map((key, rank) => candidate(key, 0, 0.55 - rank * 0.05)),
        confidence: 0.6,
        needsRerank: false,
        note: null,
      })),
    },
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    graphicCompositions: [BUBBLE],
    createdAt: 0,
    updatedAt: 0,
  });
}
