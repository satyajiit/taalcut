// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type {
  AssetId,
  CastCandidate,
  Clip,
  Id,
  Result,
  ShotId,
  SlotCast,
  SlotId,
  TaalcutError,
  TemplateId,
  Timeline,
  TimelineItemId,
} from '@taalcut/core';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  CardActionsProvider,
  CardDataProvider,
  MAKE_FIXTURE_IDS,
  type CardActions,
  type CardData,
} from '../src/index';

/** A 26-character ULID with a readable tail: one letter for the kind, then the number. */
const ulid = <T extends string>(kind: string, n: number) =>
  `01K7C5M6Q8${kind}${String(n).padStart(15, '0')}` as Id<T>;

export const RATE = { num: 30, den: 1 } as const;
export const TEMPLATE = ulid<'Template'>('P', 1) as TemplateId;
export const clipId = (n: number) => ulid<'TimelineItem'>('C', n) as TimelineItemId;
export const slotId = (n: number) => ulid<'TemplateSlot'>('T', n) as SlotId;
export const assetId = (n: number) => ulid<'Asset'>('A', n) as AssetId;
export const shotId = (n: number) => ulid<'Shot'>('S', n) as ShotId;

export const candidate = (n: number): CastCandidate => ({
  assetId: assetId(n),
  shotId: shotId(n),
  sourceStart: { value: 6 * n, rate: RATE },
  syncPoint: null,
  score: 0.8,
  parts: {
    intent: 0.8,
    motion: 0.5,
    quality: 0.7,
    subject: 0.6,
    energy: 0.5,
    hook: null,
    rerank: null,
    penalty: 0,
  },
});

export interface TimelineSpec {
  /** Slots on V1, 45 frames (three beats) each. Default 3. */
  readonly slots?: number;
  /** Slot indexes (0-based) the engine was unsure of. */
  readonly unsure?: readonly number[];
  readonly locked?: readonly number[];
  readonly userPick?: readonly number[];
  readonly revision?: number;
}

/** A small Timeline v2: 9:16 at 30 fps, a beat every 15 frames (120 BPM at the tracker's 50/1), one cast. */
export function makeTimeline(spec: TimelineSpec = {}): Timeline {
  const count = spec.slots ?? 3;
  const clips: Clip[] = [];
  const cast: SlotCast[] = [];
  for (let i = 0; i < count; i += 1) {
    const n = i + 1;
    const pick = candidate(n * 10);
    clips.push({
      type: 'clip',
      id: clipId(n),
      media: {
        kind: 'video',
        assetId: pick.assetId,
        shotId: pick.shotId,
        available: { start: { value: 0, rate: RATE }, duration: { value: 300, rate: RATE } },
      },
      sourceStart: pick.sourceStart,
      duration: { value: 45, rate: RATE },
      speed: null,
      slotId: slotId(n),
      syncPoint: null,
      beatAnchor: { beatIndex: i * 3, offset: { value: 0, rate: RATE } },
      fit: 'cover',
      audio: { gainDb: 0, muted: true },
      locked: spec.locked?.includes(i) ?? false,
      enabled: true,
      stillMotion: null,
      reframe: null,
    });
    const unsure = spec.unsure?.includes(i) ?? false;
    cast.push({
      slotId: slotId(n),
      clipId: clipId(n),
      pick,
      alternates: [candidate(n * 10 + 1), candidate(n * 10 + 2)],
      confidence: unsure ? 0.41 : 0.86,
      needsRerank: false,
      note: spec.userPick?.includes(i) ? 'userPick' : unsure ? 'reranked' : null,
    });
  }
  const beats = Array.from({ length: count * 3 + 1 }, (_, i) => ({
    value: i * 25,
    rate: { num: 50, den: 1 },
  }));
  return {
    schemaVersion: 2,
    id: MAKE_FIXTURE_IDS.timeline,
    projectId: MAKE_FIXTURE_IDS.project,
    name: 'Golden hour market',
    revision: spec.revision ?? 3,
    canvas: { width: 1080, height: 1920, rate: RATE },
    template: { id: TEMPLATE, version: 1 },
    beatMap: {
      rate: { num: 50, den: 1 },
      beats,
      downbeats: beats.flatMap((_, i) => (i % 4 === 0 ? [i] : [])),
      bpm: 120,
      beatsPerBar: 4,
      confidence: 0.9,
      source: 'tracker',
    },
    tracks: [{ kind: 'video', id: 'V1', name: '', enabled: true, items: clips }],
    markers: [],
    cast: {
      castId: MAKE_FIXTURE_IDS.cast,
      mode: 'template',
      variantIndex: 0,
      variantCount: 3,
      configVersion: 'test',
      sequenceConfidence: 0.8,
      slots: cast,
    },
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: { ducking: { enabled: true, marginLu: 8, floorDb: -30, attackMs: 80, releaseMs: 300 } },
    createdAt: 0,
    updatedAt: 0,
  };
}

export const ok = (value: unknown = null): Result<unknown> => ({ ok: true, value });
export const failed = (code = 'core.timeout'): Result<unknown> => ({
  ok: false,
  error: { code, messageKey: `errors.${code}`, retryable: true } satisfies TaalcutError,
});

/** CardData over one timeline (any other id is gone); every shot has a file name and no frame. */
export function timelineData(timeline: Timeline | null, extra: Partial<CardData> = {}): CardData {
  return {
    watchTimeline: (id, onChange) => {
      onChange(timeline && id === timeline.id ? timeline : null);
      return () => undefined;
    },
    shot: (_asset, shot) =>
      Promise.resolve({ url: null, name: `${shot ?? 'photo'}.mov`, description: null, duration: null }),
    ...extra,
  };
}

export const wrap = (node: ReactNode, actions: CardActions = {}, data: CardData = {}) =>
  render(
    <I18nProvider i18n={i18n}>
      <CardDataProvider value={data}>
        <CardActionsProvider value={actions}>{node}</CardActionsProvider>
      </CardDataProvider>
    </I18nProvider>,
  );
