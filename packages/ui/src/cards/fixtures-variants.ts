// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardOf, Id, RenderBatchProgress, TimelineId } from '@taalcut/core';
import { MAKE_FIXTURE_IDS } from './fixtures-make';
import { BATCH, PROJECT, RUN, TIMELINE } from './fixtures-phase3-ids';

/**
 * P3-V3, P3-V16: the variants compare card and the batch render card, in their states. The ids are the fake's
 * Golden hour market (three videos cut from one cast), so /dev/kit shows them live: the original at revision 7
 * (after your swap), variants 2 and 3 at revision 1, and its exported Reels render.
 */
const { cast: CAST, timeline2: SECOND, timeline3: THIRD, render: EXPORTED } = MAKE_FIXTURE_IDS;
/** A timeline the fake doesn't have: a variant deleted after the card. */
const DELETED = '01K7C5M6Q8N00000000000000Z' as TimelineId;

const step = (status: 'running' | 'ready', editedByYou = false) => ({
  flowId: '01K7C5M6Q8R9S0T1V2W3X4Y5ZF' as Id<'Flow'>,
  stepId: 'variants',
  index: 3,
  count: 4,
  status,
  editedByYou,
});

const second = {
  index: 1,
  revision: 1,
  timelineId: SECOND,
  hookChanged: true,
  picksChanged: 0.4,
  music: null,
  captionPreset: 'bold',
} as const;
const third = {
  index: 2,
  revision: 1,
  timelineId: THIRD,
  hookChanged: true,
  picksChanged: 0.6,
  music: { path: 'platformSound' },
  captionPreset: null,
} as const;

const compare = (
  patch: Partial<CardOf<'variantsCompare'>> & Pick<CardOf<'variantsCompare'>, 'variants'>,
): CardOf<'variantsCompare'> => ({
  type: 'variantsCompare',
  id: 'variants',
  version: 1,
  runId: RUN,
  step: step('ready'),
  projectId: PROJECT,
  castId: CAST,
  baseTimelineId: TIMELINE,
  baseRevision: 7,
  status: 'ready',
  asked: 2,
  short: null,
  ...patch,
});

export const VARIANTS_COMPARE_FIXTURES: Readonly<Record<string, CardOf<'variantsCompare'>>> = {
  making: compare({ status: 'making', step: step('running'), variants: [second], asked: 3 }),
  ready: compare({ variants: [second, third] }),
  short: compare({ variants: [second, third], asked: 4, short: { axis: 'hook', asked: 4, made: 2 } }),
  deleted: compare({ variants: [second, { ...third, timelineId: DELETED }] }),
  changed: compare({ step: step('ready', true), baseRevision: 3, variants: [second, third] }),
};

type BatchItem = CardOf<'renderBatch'>['items'][number];

const item = (timelineId: TimelineId, status: BatchItem['status']): BatchItem => ({
  projectId: PROJECT,
  timelineId,
  renderId: timelineId === TIMELINE ? EXPORTED : null,
  presetId: 'reels',
  status,
});

const batch = (
  id: string,
  items: readonly BatchItem[],
  etaMs: number | null,
  approvalId?: string,
): CardOf<'renderBatch'> => {
  const count = (status: BatchItem['status']) => items.filter((each) => each.status === status).length;
  const progress: RenderBatchProgress = {
    batchId: BATCH,
    total: items.length,
    queued: count('queued'),
    running: count('running'),
    ready: count('ready'),
    needsAttention: count('needsAttention'),
    failed: count('failed'),
    cancelled: count('cancelled'),
    etaMs,
  };
  return {
    type: 'renderBatch',
    id,
    version: 1,
    runId: RUN,
    progress,
    items: [...items],
    ...(approvalId ? { approvalId } : {}),
  };
};

export const RENDER_BATCH_FIXTURES: Readonly<Record<string, CardOf<'renderBatch'>>> = {
  waiting: batch(
    'batch-waiting',
    [{ ...item(TIMELINE, 'queued'), renderId: null }, item(SECOND, 'queued'), item(THIRD, 'queued')],
    null,
    'approval-batch',
  ),
  running: batch(
    'batch-running',
    [item(TIMELINE, 'ready'), item(SECOND, 'running'), item(THIRD, 'queued')],
    95_000,
  ),
  attention: batch(
    'batch-attention',
    [item(TIMELINE, 'ready'), item(SECOND, 'needsAttention'), item(THIRD, 'failed')],
    null,
  ),
  stopped: batch(
    'batch-stopped',
    [item(TIMELINE, 'ready'), item(SECOND, 'cancelled'), item(THIRD, 'cancelled')],
    null,
  ),
  done: batch('batch-done', [item(TIMELINE, 'ready'), item(SECOND, 'ready'), item(THIRD, 'ready')], null),
};
