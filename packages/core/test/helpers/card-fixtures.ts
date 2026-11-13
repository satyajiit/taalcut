// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Fixtures for Phase 2's flow and domain cards (cards.test.ts adds Phase 1's). */
import { FrameRates, newId, type CardOf, type CostEstimateCardV2, type FlowStepRef } from '@taalcut/core';

export const runId = newId<'AgentRun'>();
const projectId = newId<'Project'>();
const timelineId = newId<'Timeline'>();
const renderId = newId<'Render'>();
const sourceId = newId<'Source'>();
const usd = (micros: number) => ({ currency: 'USD', micros });
const counts = { assets: 40, done: 12, active: 2, waiting: 26, failed: 0 };

export const step: FlowStepRef = {
  flowId: newId<'Flow'>(),
  stepId: 'cast',
  index: 2,
  count: 4,
  skill: 'timeline.caster',
  status: 'ready',
  editedByYou: false,
};

const qa = {
  verdict: 'passedWithWarnings',
  round: 1,
  passed: 18,
  warned: 1,
  failed: 0,
  fixed: 1,
  failing: [],
} satisfies CardOf<'qaReport'>['summary'];

type Phase2Type =
  | 'openingChoices'
  | 'step'
  | 'budgetCap'
  | 'sourcePicker'
  | 'importProgress'
  | 'breakdown'
  | 'castBoard'
  | 'timeline'
  | 'renderProgress'
  | 'qaReport'
  | 'exportApproval';

export const PHASE2_CARDS: { [T in Phase2Type]: CardOf<T> } = {
  openingChoices: {
    type: 'openingChoices',
    version: 1,
    id: 'open-1',
    paths: ['library', 'reference', 'template', 'describe'],
    unavailable: [{ path: 'template', reasonKey: 'cards.opening.noTemplates' }],
    hasSources: true,
  },
  step: {
    type: 'step',
    version: 1,
    id: 'step-1',
    runId,
    step: { ...step, stepId: 'brief', index: 1, skill: 'agent.brief' },
    labelKey: 'skills.agent.brief',
    summary: 'A 30 s travel reel, upbeat, six shots.',
    progress: null,
    refs: [{ entity: 'template', id: 'tpl-1', version: 2 }],
  },
  budgetCap: {
    type: 'budgetCap',
    version: 1,
    id: 'cap-1',
    runId,
    projectId,
    approvalId: 'ap-cap',
    cap: usd(1_000_000),
    spent: usd(920_000),
    next: { labelKey: 'skills.timeline.caster', estimate: usd(140_000) },
    suggestedCap: usd(1_500_000),
    cheaper: [{ module: 'vision', provider: 'local', model: 'qwen2.5-vl-7b', local: true, estimate: usd(0) }],
    status: 'pending',
  },
  sourcePicker: {
    type: 'sourcePicker',
    version: 1,
    id: 'sources-1',
    runId,
    sources: [
      {
        id: sourceId,
        kind: 'watched_folder',
        name: 'Trip',
        status: 'online',
        path: '/Users/me/Movies/Trip',
        watch: true,
        scan: { state: 'idle', lastScanAt: 1_760_000_000_000 },
        assets: 40,
        missing: 0,
        createdAt: 1_760_000_000_000,
      },
    ],
    offers: ['folder', 'phone'],
    status: 'added',
  },
  importProgress: {
    type: 'importProgress',
    version: 1,
    id: 'import-1',
    sourceId,
    status: {
      sourceId,
      state: 'indexing',
      counts,
      stages: [{ stage: 'vision.shots', done: 12, left: 28, failed: 0 }],
      etaMs: 95_000,
      jobIds: [newId<'Job'>()],
      updatedAt: 1_760_000_000_000,
    },
    thumbnails: [],
  },
  breakdown: {
    type: 'breakdown',
    version: 1,
    id: 'breakdown-1',
    runId,
    step: { ...step, stepId: 'breakdown', index: 1, status: 'running' },
    jobId: newId<'Job'>(),
    stage: 'beats',
    progress: { fraction: 0.4, completed: 2, total: 5, unit: 'items' },
    source: { input: 'link', platform: 'reels', duration: { value: 900, rate: FrameRates.fps30 } },
    template: null,
  },
  castBoard: {
    type: 'castBoard',
    version: 1,
    id: 'cast-1',
    runId,
    step,
    projectId,
    castId: newId<'Cast'>(),
    timelineIds: [timelineId, newId<'Timeline'>()],
    lowConfidence: 1,
  },
  timeline: {
    type: 'timeline',
    version: 1,
    id: 'timeline-1',
    projectId,
    timelineId,
    revision: 3,
    duration: { value: 900, rate: FrameRates.fps30 },
    clipCount: 6,
  },
  renderProgress: {
    type: 'renderProgress',
    version: 1,
    id: 'render-1',
    runId,
    renderId,
    projectId,
    presetId: 'reels',
    status: 'rendering',
    progress: { fraction: 0.5, completed: 450, total: 900, unit: 'frames' },
    notify: true,
    qa: null,
    survey: true,
  },
  qaReport: {
    type: 'qaReport',
    version: 1,
    id: 'qa-1',
    renderId,
    projectId,
    summary: qa,
    checks: [
      {
        id: 'loudness',
        status: 'fixed',
        labelKey: 'qa.loudness',
        overridable: false,
        fixes: [{ kind: 'auto', action: 'renormaliseAudio' }],
      },
    ],
  },
  exportApproval: {
    type: 'exportApproval',
    version: 1,
    id: 'export-1',
    runId,
    approvalId: 'ap-export',
    projectId,
    timelineId,
    timelineRevision: 3,
    presetId: 'reels',
    presets: ['shorts', 'reels', 'tiktok'],
    captions: { burnIn: true, sidecars: ['srt'] },
    music: 'platformSound',
    draft: { renderId, qa },
    variant: { index: 1, count: 2 },
    status: 'pending',
  },
};

export const COST_ESTIMATE_V2: CostEstimateCardV2 = {
  type: 'costEstimate',
  version: 2,
  id: 'cost-2',
  runId,
  projectId,
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
  cap: { cap: usd(1_000_000), spent: usd(420_000) },
  cheaper: [],
  status: 'going-ahead',
};
