// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output: data, never translated */

import type { CardOf, CardType, JobId, McpSessionId, RunId, ToolRunId } from '@taalcut/core';
import { CONSENT_EXTERNAL_FIXTURE, COST_V2_FIXTURES } from './fixtures-flow';
import { COST_ESTIMATE_V2_FIXTURE, PHASE2_FIXTURES } from './fixtures-phase2';
import { PHASE3_FIXTURES } from './fixtures-phase3';
import { MEMORY_PROPOSAL_FIXTURES } from '../memory/memory-proposal-fixtures';
import { STYLE_PROFILE_CARD_FIXTURES } from '../profiles/style-profile-fixtures';
import { DESIGN_CHANGES_FIXTURES } from './fixtures-designs';
import { EDIT_CHANGES_FIXTURES } from './fixtures-edit';
import { MEDIA_FIXTURE_IDS, PUBLISH_PACK_FIXTURES } from './fixtures-media';
import { SOUND_RESULTS_FIXTURES } from './fixtures-sounds';

/**
 * Sample payloads for every card type, in each state worth seeing. Tests render
 * every one (light, dark, pseudo-locale), the kit page shows them, and the
 * skeleton capture uses them as stand-in content. The mapped type means a new
 * card type needs fixtures before the build passes.
 *
 * Model-written text is English on purpose: it is data, never translated.
 */
const RUN = '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as RunId;
const MCP_SESSION = '01K7C5M6Q8R9S0T1V2W3X4Y5ZV' as McpSessionId;
const TOOL_RUN = '01K7C5M6Q8R9S0T1V2W3X4Y5Z8' as ToolRunId;
const JOB = '01K7C5M6Q8R9S0T1V2W3X4Y5Z9' as JobId;
const T0 = 1_760_000_000_000;

const plan = (status: 'running' | 'done'): CardOf<'plan'> => ({
  type: 'plan',
  id: `plan-${status}`,
  version: 1,
  runId: RUN,
  steps: [
    { id: 's1', text: 'Add the Desktop/Trip folder to your library', status: 'done' },
    { id: 's2', text: 'Check the first video', status: status === 'done' ? 'done' : 'running' },
    { id: 's3', text: 'Look at a frame and describe it', status: status === 'done' ? 'done' : 'pending' },
  ],
});

const toolRun = (status: CardOf<'toolRun'>['status']): CardOf<'toolRun'> => ({
  type: 'toolRun',
  id: `tool-${status}`,
  version: 1,
  runId: RUN,
  toolRunId: TOOL_RUN,
  tool: 'media.probe',
  status,
  startedAt: T0,
  ...(status === 'running' ? {} : { finishedAt: T0 + 1_840 }),
  ...(status === 'succeeded'
    ? { summary: 'IMG_0412.MOV: 48 seconds of 4K video at 30 fps, with sound.', artifactIds: ['a1'] }
    : {}),
  ...(status === 'failed'
    ? {
        error: {
          code: 'core.timeout',
          messageKey: 'errors.core.timeout',
          retryable: true,
          fix: { command: 'agent.retryStep', labelKey: 'fix.retry', payload: { toolRunId: TOOL_RUN } },
        },
      }
    : {}),
});

export const CARD_FIXTURES: { readonly [T in CardType]: Readonly<Record<string, CardOf<T>>> } = {
  plan: { running: plan('running'), finished: plan('done') },
  approval: {
    pending: {
      type: 'approval',
      id: 'approval-pending',
      version: 1,
      runId: RUN,
      approvalId: 'ap-1',
      tool: 'timeline.build',
      sideEffect: 'write',
      summary: 'Replace the opening shot with the sunset clip from IMG_0418.',
      details: 'The current opening shot moves to the end of the timeline.',
      status: 'pending',
    },
    destructive: {
      type: 'approval',
      id: 'approval-destructive',
      version: 1,
      runId: RUN,
      approvalId: 'ap-2',
      tool: 'library.removeSource',
      sideEffect: 'destructive',
      summary: 'Remove the Old exports folder and its 12 renders from Taalcut.',
      status: 'pending',
    },
    // P3-V4: an external agent's ask, named as the person named its session.
    external: {
      type: 'approval',
      id: 'approval-external',
      version: 1,
      runId: RUN,
      approvalId: 'ap-mcp-1',
      tool: 'render.start',
      sideEffect: 'write',
      summary: 'Export the Goa reel at 1080p for Reels.',
      status: 'pending',
      requester: { kind: 'mcp', sessionId: MCP_SESSION, name: 'Claude Code' },
    },
    externalLongName: {
      type: 'approval',
      id: 'approval-external-long',
      version: 1,
      runId: RUN,
      approvalId: 'ap-mcp-2',
      tool: 'timeline.build',
      sideEffect: 'write',
      summary: 'Swap the third clip for the sunset shot.',
      status: 'pending',
      requester: {
        kind: 'mcp',
        sessionId: MCP_SESSION,
        name: 'Codex on the studio MacBook Pro for the long-running edits 2',
      },
    },
    approved: {
      type: 'approval',
      id: 'approval-approved',
      version: 1,
      runId: RUN,
      approvalId: 'ap-3',
      tool: 'render.start',
      sideEffect: 'external',
      summary: 'Upload the finished reel to your Instagram drafts.',
      status: 'approved',
    },
  },
  consent: {
    pending: {
      type: 'consent',
      id: 'consent-pending',
      version: 1,
      runId: RUN,
      approvalId: 'ap-consent-1',
      tool: 'vision.describeFrame',
      upload: {
        modules: ['vision'],
        providers: ['google'],
        files: ['/Users/asha/Movies/Goa/IMG_0418.MOV'],
        sources: ['user-media'],
      },
      estimate: { money: { currency: 'USD', micros: 1_200 }, tokens: 1_800 },
      options: ['allow-once', 'always-allow', 'deny'],
      status: 'pending',
    },
    reference: {
      type: 'consent',
      id: 'consent-reference',
      version: 1,
      runId: RUN,
      approvalId: 'ap-consent-2',
      tool: 'vision.describeFrame',
      upload: {
        modules: ['vision'],
        providers: ['google'],
        files: ['/Users/asha/Library/Application Support/Taalcut/scratch/exp-1/sheet.jpg'],
        sources: ['reference'],
      },
      estimate: { money: { currency: 'USD', micros: 800 }, tokens: 1_200 },
      options: ['allow-once', 'always-allow', 'deny'],
      status: 'pending',
    },
    external: CONSENT_EXTERNAL_FIXTURE,
  },
  costEstimate: {
    needsApproval: {
      type: 'costEstimate',
      id: 'cost-approval',
      version: 1,
      runId: RUN,
      tool: 'vision.describeFrame',
      estimate: { money: { currency: 'USD', micros: 42_000 }, tokens: 12_400, durationMs: 9_000 },
      remaining: { money: { currency: 'USD', micros: 1_580_000 }, tokens: 188_000 },
      requiresApproval: true,
      approvalId: 'ap-cost-1',
    },
    informational: {
      type: 'costEstimate',
      id: 'cost-info',
      version: 1,
      runId: RUN,
      estimate: { tokens: 3_200, durationMs: 2_500 },
      requiresApproval: false,
    },
    flowStep: COST_ESTIMATE_V2_FIXTURE,
    ...COST_V2_FIXTURES,
  },
  error: {
    withFix: {
      type: 'error',
      id: 'error-fix',
      version: 1,
      error: {
        code: 'core.not_found',
        messageKey: 'errors.core.not_found',
        params: { entity: 'source' },
        retryable: false,
        fix: { command: 'sources.choose', labelKey: 'fix.chooseFolder' },
      },
    },
    unknownCode: {
      type: 'error',
      id: 'error-unknown',
      version: 1,
      error: { code: 'media.probe_failed', messageKey: 'errors.media.probe_failed', retryable: false },
    },
  },
  progress: {
    determinate: {
      type: 'progress',
      id: 'progress-determinate',
      version: 1,
      jobId: JOB,
      labelKey: 'cards.progress.indexingLibrary',
      state: 'running',
      progress: {
        fraction: 0.4,
        completed: 18,
        total: 45,
        unit: 'items',
        stageKey: 'jobs.stage.extractingFrames',
        etaMs: 95_000,
      },
    },
    indeterminate: {
      type: 'progress',
      id: 'progress-indeterminate',
      version: 1,
      labelKey: 'cards.progress.importing',
      state: 'queued',
      progress: null,
    },
    finished: {
      type: 'progress',
      id: 'progress-finished',
      version: 1,
      jobId: JOB,
      labelKey: 'cards.progress.rendering',
      state: 'succeeded',
      progress: { fraction: 1 },
    },
  },
  toolRun: {
    running: toolRun('running'),
    succeeded: toolRun('succeeded'),
    failed: toolRun('failed'),
    cancelled: toolRun('cancelled'),
    'saved cover': {
      ...toolRun('succeeded'),
      id: 'cover-saved',
      tool: 'render.exportCover',
      savedCover: {
        fileName: 'Golden hour cover.jpg',
        assetId: MEDIA_FIXTURE_IDS.takes[0],
        width: 1080,
        height: 1920,
        revision: 41,
      },
    },
  },
  ...PHASE2_FIXTURES,
  ...PHASE3_FIXTURES,
  memoryProposal: MEMORY_PROPOSAL_FIXTURES,
  styleProfile: STYLE_PROFILE_CARD_FIXTURES,
  editChanges: { ...EDIT_CHANGES_FIXTURES, ...DESIGN_CHANGES_FIXTURES },
  publishPack: PUBLISH_PACK_FIXTURES,
  soundResults: SOUND_RESULTS_FIXTURES,
};
