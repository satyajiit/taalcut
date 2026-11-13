// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output and model names: data, never translated */

import type { CardOf, CheaperOption, CostEstimateCardV2, FlowStepRef, Id, QaSummary } from '@taalcut/core';

/**
 * Sample payloads for the flow cards UI round 2b built (P2-M13, P2-X1), in
 * each state worth seeing: fixtures-phase2.ts and fixtures.ts spread them in.
 */
const RUN = '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as Id<'AgentRun'>;
const PROJECT = '01K7C5M6Q8R9S0T1V2W3X4Y5ZA' as Id<'Project'>;
const TIMELINE = '01K7C5M6Q8R9S0T1V2W3X4Y5ZB' as Id<'Timeline'>;
const RENDER = '01K7C5M6Q8R9S0T1V2W3X4Y5ZC' as Id<'Render'>;
const FLOW = '01K7C5M6Q8R9S0T1V2W3X4Y5ZD' as Id<'Flow'>;
/** The external agent's session the approval fixtures use (fixtures.ts), so Change what it can do lands on it. */
const MCP_SESSION = '01K7C5M6Q8R9S0T1V2W3X4Y5ZV' as Id<'McpSession'>;
const usd = (micros: number) => ({ currency: 'USD', micros });

const step = (
  stepId: string,
  index: number,
  status: FlowStepRef['status'],
  editedByYou = false,
): FlowStepRef => ({
  flowId: FLOW,
  stepId,
  index,
  count: 4,
  status,
  editedByYou,
});

const CHEAPER: CheaperOption[] = [
  {
    module: 'vision',
    provider: 'google',
    model: 'gemini-2.5-flash-lite',
    local: false,
    estimate: usd(40_000),
  },
  { module: 'vision', provider: 'on-device', model: 'qwen3.5-4b', local: true, estimate: usd(0) },
];

const BRIEF = 'A 30 s travel reel of Goa: upbeat, six shots, the beach at sunset first and the market last.';

export const OPENING_FIXTURES: Readonly<Record<string, CardOf<'openingChoices'>>> = {
  newChat: {
    type: 'openingChoices',
    id: 'opening',
    version: 1,
    paths: ['library', 'reference', 'template', 'describe'],
    unavailable: [],
    hasSources: true,
  },
  localOnly: {
    type: 'openingChoices',
    id: 'opening-local',
    version: 1,
    runId: RUN,
    paths: ['library', 'reference', 'template', 'describe'],
    unavailable: [{ path: 'reference', reasonKey: 'opening.reference.localOnly' }],
    hasSources: false,
  },
  chosen: {
    type: 'openingChoices',
    id: 'opening-chosen',
    version: 1,
    runId: RUN,
    paths: ['library', 'reference', 'template', 'describe'],
    unavailable: [],
    hasSources: true,
    chosen: 'reference',
  },
};

export const STEP_FIXTURES: Readonly<Record<string, CardOf<'step'>>> = {
  brief: {
    type: 'step',
    id: 'step-brief',
    version: 1,
    runId: RUN,
    step: step('brief', 1, 'ready'),
    labelKey: 'skills.agent.brief',
    summary: BRIEF,
    progress: null,
    refs: [],
  },
  working: {
    type: 'step',
    id: 'step-working',
    version: 1,
    runId: RUN,
    step: step('brief', 1, 'running'),
    labelKey: 'skills.agent.brief',
    progress: { fraction: 0.35 },
    refs: [],
  },
  changed: {
    type: 'step',
    id: 'step-changed',
    version: 1,
    runId: RUN,
    step: step('brief', 1, 'updating', true),
    labelKey: 'skills.agent.brief',
    summary: 'A 20 s reel of Goa, calm, the market first.',
    progress: null,
    refs: [],
  },
};

export const BUDGET_CAP_FIXTURES: Readonly<Record<string, CardOf<'budgetCap'>>> = {
  pending: {
    type: 'budgetCap',
    id: 'budget-cap',
    version: 1,
    runId: RUN,
    projectId: PROJECT,
    approvalId: 'ap-cap',
    cap: usd(2_000_000),
    spent: usd(1_920_000),
    next: { labelKey: 'skills.timeline.librarian', estimate: usd(140_000) },
    suggestedCap: usd(2_500_000),
    cheaper: CHEAPER,
    status: 'pending',
  },
  raised: {
    type: 'budgetCap',
    id: 'budget-cap-raised',
    version: 1,
    runId: RUN,
    projectId: PROJECT,
    approvalId: 'ap-cap-2',
    cap: usd(2_000_000),
    spent: usd(1_920_000),
    next: { labelKey: 'skills.timeline.librarian', estimate: usd(140_000) },
    suggestedCap: usd(2_500_000),
    cheaper: [],
    status: 'raised',
  },
  // Round P3-3: an external agent's run reached the cap; the card says who is asking.
  external: {
    type: 'budgetCap',
    id: 'budget-cap-external',
    version: 1,
    runId: RUN,
    projectId: PROJECT,
    approvalId: 'ap-cap-mcp',
    cap: usd(2_000_000),
    spent: usd(1_920_000),
    next: { labelKey: 'skills.timeline.librarian', estimate: usd(140_000) },
    suggestedCap: usd(2_500_000),
    cheaper: CHEAPER,
    status: 'pending',
    requester: { kind: 'mcp', sessionId: MCP_SESSION, name: 'Claude Code' },
  },
};

/** Round P3-3: an external agent's upload asks first, naming who asks (fixtures.ts lists it under consent). */
export const CONSENT_EXTERNAL_FIXTURE: CardOf<'consent'> = {
  type: 'consent',
  id: 'consent-external',
  version: 1,
  runId: RUN,
  approvalId: 'ap-consent-mcp',
  tool: 'vision.describeFrame',
  upload: {
    modules: ['vision'],
    providers: ['google'],
    files: ['/Users/asha/Movies/Goa/IMG_0421.MOV'],
    sources: ['user-media'],
  },
  estimate: { money: usd(1_200), tokens: 1_800 },
  options: ['allow-once', 'always-allow', 'deny'],
  status: 'pending',
  requester: { kind: 'mcp', sessionId: MCP_SESSION, name: 'Claude Code' },
};

const costV2 = (id: string, status: CostEstimateCardV2['status']) =>
  ({
    type: 'costEstimate',
    id,
    version: 2,
    runId: RUN,
    projectId: PROJECT,
    phase: { labelKey: 'skills.templates.analyst', skill: 'templates.analyst' },
    estimate: { money: usd(120_000), tokens: 48_000 },
    lines: [
      {
        module: 'vision',
        provider: 'google',
        model: 'gemini-2.5-flash',
        local: false,
        money: usd(120_000),
        tokens: 46_000,
      },
      {
        module: 'agent',
        provider: 'on-device',
        model: 'qwen3.5-4b',
        local: true,
        money: usd(0),
        tokens: 2_000,
      },
    ],
    cap: { cap: usd(2_000_000), spent: usd(420_000) },
    cheaper: CHEAPER,
    status,
    ...(status === 'asking' ? { approvalId: 'ap-cost' } : {}),
    ...(status === 'settled' ? { actual: { money: usd(100_000), tokens: 41_000 } } : {}),
  }) satisfies CardOf<'costEstimate'>;

export const COST_V2_FIXTURES: Readonly<Record<string, CardOf<'costEstimate'>>> = {
  goingAhead: costV2('cost-going', 'going-ahead'),
  asking: costV2('cost-asking', 'asking'),
  settled: costV2('cost-settled', 'settled'),
};

const qa: QaSummary = {
  verdict: 'passedWithWarnings',
  round: 1,
  passed: 17,
  warned: 1,
  failed: 0,
  fixed: 1,
  failing: [],
};

const exportCard = (id: string, status: CardOf<'exportApproval'>['status']): CardOf<'exportApproval'> => ({
  type: 'exportApproval',
  id,
  version: 1,
  runId: RUN,
  approvalId: `ap-${id}`,
  projectId: PROJECT,
  timelineId: TIMELINE,
  timelineRevision: 3,
  presetId: 'reels',
  presets: ['shorts', 'reels', 'tiktok'],
  captions: { burnIn: true, sidecars: [] },
  music: 'platformSound',
  draft: { renderId: RENDER, qa },
  variant: { index: 1, count: 3 },
  status,
});

export const EXPORT_APPROVAL_FIXTURES: Readonly<Record<string, CardOf<'exportApproval'>>> = {
  pending: exportCard('export', 'pending'),
  updating: exportCard('export-updating', 'updating'),
  exported: exportCard('export-done', 'exported'),
  declined: exportCard('export-declined', 'declined'),
};

export const SURVEY_RENDER_FIXTURE: CardOf<'renderProgress'> = {
  type: 'renderProgress',
  id: 'render-done',
  version: 1,
  runId: RUN,
  renderId: RENDER,
  projectId: PROJECT,
  presetId: 'reels',
  status: 'ready',
  progress: { fraction: 1 },
  notify: false,
  qa,
  survey: true,
};
