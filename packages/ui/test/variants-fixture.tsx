// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { CardOf, RenderSnapshot, Timeline, TimelineId } from '@taalcut/core';
import type { ReactNode } from 'react';
import {
  MAKE_FIXTURE_IDS,
  VariantPlayerProvider,
  type CardActions,
  type CardData,
  type VariantPlayerProps,
} from '../src/index';
import { makeTimeline, RATE, wrap } from './make-fixture';

/** What the variants tests share: the Golden hour cast's three videos, a recording player, a card. */
export const { project: PROJECT, timeline: ORIGINAL, timeline2: SECOND, timeline3: THIRD } = MAKE_FIXTURE_IDS;

/** Three slots of 45 frames: 4.5 s at 30 fps. */
export const LENGTH_MS = 4500;

export const timelineAt = (id: TimelineId, revision = 1): Timeline => ({ ...makeTimeline(), id, revision });

/** CardData over these timelines (any other id is gone), with renders from `renders`. */
export function compareData(
  timelines: readonly Timeline[],
  renders: Readonly<Record<string, RenderSnapshot>> = {},
  extra: Partial<CardData> = {},
): CardData {
  return {
    watchTimeline: (id, onChange) => {
      onChange(timelines.find((timeline) => timeline.id === id) ?? null);
      return () => undefined;
    },
    watchLatestRender: (id, _purpose, onChange) => {
      onChange(renders[id] ?? null);
      return () => undefined;
    },
    shot: () => Promise.resolve({ url: null, name: 'clip.mov', description: null, duration: null }),
    ...extra,
  };
}

export const card = (patch: Partial<CardOf<'variantsCompare'>> = {}): CardOf<'variantsCompare'> => ({
  type: 'variantsCompare',
  id: 'variants',
  version: 1,
  projectId: PROJECT,
  castId: MAKE_FIXTURE_IDS.cast,
  baseTimelineId: ORIGINAL,
  baseRevision: 3,
  status: 'ready',
  variants: [
    {
      index: 1,
      revision: 1,
      timelineId: SECOND,
      hookChanged: true,
      picksChanged: 0.4,
      music: null,
      captionPreset: 'bold',
    },
    {
      index: 2,
      revision: 1,
      timelineId: THIRD,
      hookChanged: false,
      picksChanged: 0.25,
      music: { path: 'platformSound' },
      captionPreset: null,
    },
  ],
  asked: 2,
  short: null,
  ...patch,
});

/** A player that shows what the clock asks of it, one per timeline. */
export function recordingPlayer(): (props: VariantPlayerProps) => ReactNode {
  return function Player({ timelineId, playing, epoch, label }: VariantPlayerProps) {
    return (
      <span
        data-testid={`player-${timelineId}`}
        data-playing={String(playing)}
        data-epoch={epoch}
        aria-label={label}
        role="img"
      />
    );
  };
}

export function renderSnapshot(
  timelineId: TimelineId,
  status: RenderSnapshot['status'],
  extra: Partial<RenderSnapshot> = {},
): RenderSnapshot {
  return {
    id: MAKE_FIXTURE_IDS.render,
    projectId: PROJECT,
    timelineId,
    timelineRevision: 1,
    presetId: 'reels',
    status,
    jobId: null,
    progress: null,
    name: 'Golden hour market – Instagram Reels',
    width: 1080,
    height: 1920,
    rate: RATE,
    durationFrames: 135,
    bytes: null,
    music: 'platformSound',
    captions: { burnIn: true, sidecars: [] },
    qa: null,
    supersedes: null,
    notify: false,
    error: null,
    credentials: { added: false, state: null },
    batchId: null,
    createdAt: 0,
    finishedAt: null,
    deletedAt: null,
    ...extra,
  };
}

export const withPlayer = (node: ReactNode, actions: CardActions = {}, data: CardData = {}) =>
  wrap(<VariantPlayerProvider render={recordingPlayer()}>{node}</VariantPlayerProvider>, actions, data);
