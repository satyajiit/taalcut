// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardOf, FlowStepRef, Id } from '@taalcut/core';
import {
  BUDGET_CAP_FIXTURES,
  EXPORT_APPROVAL_FIXTURES,
  OPENING_FIXTURES,
  STEP_FIXTURES,
  SURVEY_RENDER_FIXTURE,
} from './fixtures-flow';
import { MAKE_FIXTURES } from './fixtures-make';
import type { Phase2CardType } from './pending-card';

/** Sample payloads for Phase 2's cards (fixtures.ts spreads them into CARD_FIXTURES). */
const RUN = '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as Id<'AgentRun'>;
const PROJECT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZA' as Id<'Project'>;
const SOURCE = '01K7C5M6Q8R9S0T1V2W3X4Y5ZF' as Id<'Source'>;
const SOURCE_2 = '01K7C5M6Q8R9S0T1V2W3X4Y5ZG' as Id<'Source'>;
type ImportState = CardOf<'importProgress'>['status']['state'];

/**
 * An import of 40 clips at `done`, with `failed` files that couldn't be read; `searchable` clips search can
 * already find (round IX: ten ahead of `done` by default; every clip once done).
 */
const importing = (
  state: ImportState,
  done: number,
  failed: number,
  searchable = Math.min(40, done + 10),
): CardOf<'importProgress'> => ({
  type: 'importProgress',
  id: `import-${state}-${done}`,
  version: 1,
  sourceId: SOURCE,
  status: {
    sourceId: SOURCE,
    state,
    counts: {
      assets: 40,
      done,
      active: state === 'indexing' ? 2 : 0,
      waiting: 40 - done,
      failed,
      searchable,
    },
    stages: [
      { stage: 'media.normalise', done: searchable, left: 40 - searchable, failed, milestone: 'searchable' },
      { stage: 'vision.shots', done: searchable, left: 40 - searchable, failed: 0, milestone: 'searchable' },
      { stage: 'vision.describe', done, left: 40 - done, failed: 0, milestone: 'complete' },
    ],
    etaMs: state === 'indexing' ? 95_000 : null,
    jobIds: [],
    updatedAt: T0,
  },
  thumbnails: [],
});
const T0 = 1_760_000_000_000;
const usd = (micros: number) => ({ currency: 'USD', micros });

const step = (stepId: string, index: number, status: FlowStepRef['status']): FlowStepRef => ({
  flowId: '01K7C5M6Q8R9S0T1V2W3X4Y5ZD' as Id<'Flow'>,
  stepId,
  index,
  count: 4,
  status,
  editedByYou: false,
});

export const COST_ESTIMATE_V2_FIXTURE: CardOf<'costEstimate'> = {
  type: 'costEstimate',
  id: 'cost-step',
  version: 2,
  runId: RUN,
  projectId: PROJECT,
  phase: { labelKey: 'skills.timeline.caster', skill: 'timeline.caster' },
  estimate: { money: usd(140_000), tokens: 52_000 },
  lines: [
    {
      module: 'vision',
      provider: 'google',
      model: 'gemini-2.5-flash',
      local: false,
      money: usd(140_000),
      tokens: 52_000,
    },
  ],
  cap: { cap: usd(2_000_000), spent: usd(420_000) },
  cheaper: [],
  status: 'going-ahead',
};

export const PHASE2_FIXTURES: {
  readonly [T in Exclude<Phase2CardType, 'costEstimate'>]: Readonly<Record<string, CardOf<T>>>;
} = {
  // UI round 2b's flow cards (fixtures-flow.ts).
  openingChoices: OPENING_FIXTURES,
  step: STEP_FIXTURES,
  budgetCap: BUDGET_CAP_FIXTURES,
  sourcePicker: {
    empty: {
      type: 'sourcePicker',
      id: 'sources-empty',
      version: 1,
      runId: RUN,
      sources: [],
      offers: ['folder', 'phone'],
      status: 'pending',
    },
    added: {
      type: 'sourcePicker',
      id: 'sources',
      version: 1,
      runId: RUN,
      sources: [
        {
          id: SOURCE,
          kind: 'watched_folder',
          name: 'Trip',
          status: 'online',
          path: '/Users/me/Movies/Trip',
          watch: true,
          scan: { state: 'idle', lastScanAt: T0 },
          assets: 40,
          missing: 0,
          createdAt: T0,
        },
        {
          id: SOURCE_2,
          kind: 'watched_folder',
          name: 'Samsung T7',
          status: 'offline',
          path: '/Volumes/Samsung T7',
          watch: true,
          scan: { state: 'idle', lastScanAt: T0 },
          assets: 1204,
          missing: 0,
          createdAt: T0,
        },
      ],
      offers: ['folder', 'phone'],
      status: 'added',
    },
  },
  importProgress: {
    indexing: importing('indexing', 12, 0),
    allSearchable: importing('indexing', 28, 0, 40),
    paused: importing('paused', 12, 0),
    someFailed: importing('indexing', 31, 2),
    done: importing('done', 40, 0),
  },
  breakdown: {
    analysing: {
      type: 'breakdown',
      id: 'breakdown',
      version: 1,
      runId: RUN,
      step: step('breakdown', 1, 'running'),
      stage: 'beats',
      progress: { fraction: 0.4 },
      source: { input: 'link', platform: 'reels', duration: { value: 900, rate: { num: 30, den: 1 } } },
      template: null,
    },
    failed: {
      type: 'breakdown',
      id: 'breakdown-failed',
      version: 1,
      runId: RUN,
      stage: 'failed',
      progress: null,
      source: { input: 'link', platform: 'reels', duration: null },
      template: null,
      error: { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true },
    },
  },
  // The Make cards' own fixtures (fixtures-make.ts), with the flow's survey (fixtures-flow.ts).
  castBoard: MAKE_FIXTURES.castBoard,
  timeline: MAKE_FIXTURES.timeline,
  renderProgress: { ...MAKE_FIXTURES.renderProgress, surveyed: SURVEY_RENDER_FIXTURE },
  qaReport: MAKE_FIXTURES.qaReport,
  exportApproval: { ...EXPORT_APPROVAL_FIXTURES, ...MAKE_FIXTURES.exportApproval },
};
