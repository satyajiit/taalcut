// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardOf, FlowStepRef, Id, QaSummary } from '@taalcut/core';

/**
 * Sample payloads for the Make cards (P2-M3, P2-M7, P2-M8, P2-M11, P2-M13;
 * Phase 3: the new QA checks, the Framing and Signing stages, the AI label),
 * spread into CARD_FIXTURES by fixtures-phase2.ts. The ids are the renderer
 * fake's seeded project (Golden hour market): its first timeline, its ready
 * render, and its other two variants, so in the app these cards read live data.
 */
export const MAKE_FIXTURE_IDS = {
  run: '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as Id<'AgentRun'>,
  project: '01K7C5M6Q8R9S0T1V2W3X4Y5ZA' as Id<'Project'>,
  timeline: '01K7C5M6Q8R9S0T1V2W3X4Y5ZB' as Id<'Timeline'>,
  timeline2: '01K7C5M6Q8N000000000000002' as Id<'Timeline'>,
  timeline3: '01K7C5M6Q8N000000000000003' as Id<'Timeline'>,
  render: '01K7C5M6Q8R9S0T1V2W3X4Y5ZC' as Id<'Render'>,
  cast: '01K7C5M6Q8R9S0T1V2W3X4Y5ZE' as Id<'Cast'>,
} as const;

const { run: RUN, project: PROJECT, timeline: TIMELINE, render: RENDER } = MAKE_FIXTURE_IDS;

const step = (stepId: string, index: number, status: FlowStepRef['status']): FlowStepRef => ({
  flowId: '01K7C5M6Q8R9S0T1V2W3X4Y5ZD' as Id<'Flow'>,
  stepId,
  index,
  count: 4,
  status,
  editedByYou: false,
});

const passedWithWarning: QaSummary = {
  verdict: 'passedWithWarnings',
  round: 1,
  passed: 18,
  warned: 1,
  failed: 0,
  fixed: 1,
  failing: [],
};
const passed: QaSummary = {
  verdict: 'passed',
  round: 1,
  passed: 19,
  warned: 0,
  failed: 0,
  fixed: 0,
  failing: [],
};
const failing: QaSummary = {
  verdict: 'needsAttention',
  round: 2,
  passed: 17,
  warned: 0,
  failed: 2,
  fixed: 1,
  failing: ['captionSafeZone', 'frozenFrames'],
};

/** Phase 3's checks failing: a reframed clip loses its subject, the voice is under the music, credentials invalid. */
const phase3Failing: QaSummary = {
  verdict: 'needsAttention',
  round: 1,
  passed: 25,
  warned: 0,
  failed: 3,
  fixed: 0,
  failing: ['subjectInFrame', 'voiceOverMusic', 'contentCredentials'],
};

const render = (
  id: string,
  status: CardOf<'renderProgress'>['status'],
  extra: Partial<CardOf<'renderProgress'>> = {},
): CardOf<'renderProgress'> => ({
  type: 'renderProgress',
  id,
  version: 1,
  runId: RUN,
  renderId: RENDER,
  projectId: PROJECT,
  presetId: 'reels',
  status,
  progress: null,
  notify: false,
  qa: null,
  // An export's card asks "Would you post this?" once ready; the reviewer's draft (below) doesn't (UX4).
  survey: true,
  ...extra,
});

/** The reviewer's draft before the one approval: render.draft's card, which never says "Exported". */
const draftRender = (status: CardOf<'renderProgress'>['status']): CardOf<'renderProgress'> => {
  const { survey: _survey, ...card } = render(`render-draft-${status}`, status, {
    progress: status === 'ready' ? { fraction: 1 } : { fraction: 0.4 },
    qa: status === 'ready' ? passedWithWarning : null,
  });
  return card;
};

const approval = (
  status: CardOf<'exportApproval'>['status'],
  extra: Partial<CardOf<'exportApproval'>> = {},
): CardOf<'exportApproval'> => ({
  type: 'exportApproval',
  id: `export-${status}`,
  version: 1,
  runId: RUN,
  approvalId: `ap-export-${status}`,
  projectId: PROJECT,
  timelineId: TIMELINE,
  timelineRevision: 3,
  presetId: 'reels',
  presets: ['reels', 'shorts', 'tiktok'],
  captions: { burnIn: true, sidecars: [] },
  music: 'platformSound',
  draft: { renderId: RENDER, qa: passedWithWarning },
  variant: { index: 1, count: 3 },
  status,
  ...extra,
});

export const MAKE_FIXTURES = {
  castBoard: {
    asking: {
      type: 'castBoard',
      id: 'cast-asking',
      version: 1,
      runId: RUN,
      step: step('cast', 2, 'waiting'),
      projectId: PROJECT,
      castId: null,
      timelineIds: [],
      lowConfidence: 0,
      asking: { approvalId: 'ap-variants', suggested: 3, slotCount: 12 },
    },
    casting: {
      type: 'castBoard',
      id: 'cast-casting',
      version: 1,
      runId: RUN,
      step: step('cast', 2, 'running'),
      projectId: PROJECT,
      castId: MAKE_FIXTURE_IDS.cast,
      timelineIds: [],
      lowConfidence: 0,
    },
    cast: {
      type: 'castBoard',
      id: 'cast',
      version: 1,
      runId: RUN,
      step: step('cast', 2, 'ready'),
      projectId: PROJECT,
      castId: MAKE_FIXTURE_IDS.cast,
      timelineIds: [TIMELINE, MAKE_FIXTURE_IDS.timeline2, MAKE_FIXTURE_IDS.timeline3],
      lowConfidence: 1,
    },
  },
  timeline: {
    cut: {
      type: 'timeline',
      id: 'timeline',
      version: 1,
      runId: RUN,
      step: step('edit', 3, 'ready'),
      projectId: PROJECT,
      timelineId: TIMELINE,
      revision: 3,
      duration: { value: 450, rate: { num: 30, den: 1 } },
      clipCount: 12,
    },
  },
  qaReport: {
    passed: {
      type: 'qaReport',
      id: 'qa-passed',
      version: 1,
      runId: RUN,
      renderId: RENDER,
      projectId: PROJECT,
      summary: passed,
      checks: [],
    },
    warning: {
      type: 'qaReport',
      id: 'qa',
      version: 1,
      runId: RUN,
      step: step('check', 4, 'ready'),
      renderId: RENDER,
      projectId: PROJECT,
      summary: passedWithWarning,
      checks: [
        {
          id: 'captionSafeZone',
          status: 'fixed',
          labelKey: 'qa.checks.captionSafeZone',
          overridable: false,
          fixes: [],
        },
        { id: 'loudness', status: 'warn', labelKey: 'qa.checks.loudness', overridable: true, fixes: [] },
      ],
    },
    needsAttention: {
      type: 'qaReport',
      id: 'qa-attention',
      version: 1,
      runId: RUN,
      renderId: RENDER,
      projectId: PROJECT,
      summary: failing,
      checks: [
        {
          id: 'captionSafeZone',
          status: 'fail',
          labelKey: 'qa.checks.captionSafeZone',
          overridable: true,
          fixes: [
            {
              kind: 'command',
              labelKey: 'qa.fixes.moveCaptions',
              command: 'captions.setStyle',
              payload: { projectId: PROJECT, timelineId: TIMELINE, style: { anchorY: 0.52 } },
            },
          ],
        },
        {
          id: 'frozenFrames',
          status: 'fail',
          labelKey: 'qa.checks.frozenFrames',
          overridable: true,
          fixes: [{ kind: 'agent', instructionKey: 'qa.fixes.swapOrTrimStatic', params: { clip: 4 } }],
        },
        {
          id: 'blackFrames',
          status: 'fixed',
          labelKey: 'qa.checks.blackFrames',
          overridable: false,
          fixes: [],
        },
      ],
    },
    phase3: {
      type: 'qaReport',
      id: 'qa-phase3',
      version: 1,
      runId: RUN,
      renderId: RENDER,
      projectId: PROJECT,
      summary: phase3Failing,
      checks: [
        {
          id: 'subjectInFrame',
          status: 'fail',
          labelKey: 'qa.checks.subjectInFrame',
          overridable: true,
          fixes: [
            {
              kind: 'command',
              labelKey: 'qa.fixes.reframeBlurPad',
              command: 'timeline.setReframe',
              payload: {
                projectId: PROJECT,
                timelineId: TIMELINE,
                clipId: '01K7C5M6Q8C000000000000004',
                reframe: { mode: 'blurPad', nudge: { x: 0, y: 0 }, scale: 1 },
              },
            },
          ],
        },
        {
          id: 'voiceOverMusic',
          status: 'fail',
          labelKey: 'qa.checks.voiceOverMusic',
          overridable: true,
          fixes: [
            {
              kind: 'command',
              labelKey: 'qa.fixes.raiseDucking',
              command: 'music.setDucking',
              payload: { projectId: PROJECT, timelineId: TIMELINE, ducking: { enabled: true, marginLu: 10 } },
            },
          ],
        },
        {
          id: 'contentCredentials',
          status: 'fail',
          labelKey: 'qa.checks.contentCredentials',
          overridable: false,
          fixes: [{ kind: 'auto', action: 'remux' }],
        },
        {
          id: 'brandAssets',
          status: 'warn',
          labelKey: 'qa.checks.brandAssets',
          overridable: true,
          fixes: [{ kind: 'agent', instructionKey: 'qa.fixes.replaceBrandAsset', params: { problems: 1 } }],
        },
      ],
    },
    checking: {
      type: 'qaReport',
      id: 'qa-checking',
      version: 1,
      runId: RUN,
      step: step('check', 4, 'running'),
      renderId: RENDER,
      projectId: PROJECT,
      summary: passedWithWarning,
      checks: [],
    },
  },
  renderProgress: {
    draft: draftRender('rendering'),
    draftReady: draftRender('ready'),
    queued: render('render-queued', 'queued'),
    rendering: render('render', 'rendering', {
      progress: { fraction: 0.42, stageKey: 'render.stage.capturing', etaMs: 38_000 },
    }),
    ready: render('render-ready', 'ready', {
      progress: { fraction: 1 },
      qa: passedWithWarning,
      survey: true,
    }),
    framing: render('render-framing', 'rendering', {
      progress: { fraction: 0.05, stageKey: 'render.stage.reframing', etaMs: 52_000 },
    }),
    signing: render('render-signing', 'rendering', {
      progress: { fraction: 0.96, stageKey: 'render.stage.signing', etaMs: 3_000 },
    }),
    needsAttention: render('render-attention', 'needsAttention', { qa: failing }),
    failed: render('render-failed', 'failed'),
    cancelled: render('render-cancelled', 'cancelled'),
  },
  exportApproval: {
    pending: approval('pending', { id: 'export', approvalId: 'ap-export' }),
    updating: approval('updating'),
    exporting: approval('exporting', { renderId: RENDER }),
    exported: approval('exported', { renderId: RENDER }),
    declined: approval('declined'),
    expired: approval('expired'),
    // P3-V7: two sources signed by their makers, a model made part of it: the switch, the note, the reminders.
    credentials: approval('pending', {
      id: 'export-credentials',
      approvalId: 'ap-export-credentials',
      credentials: { add: false, sourcesWithCredentials: 2, disclosures: ['shorts', 'reels', 'tiktok'] },
    }),
  },
} as const satisfies {
  readonly [T in 'castBoard' | 'timeline' | 'qaReport' | 'renderProgress' | 'exportApproval']: Readonly<
    Record<string, CardOf<T>>
  >;
};
