// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The smart-card payload protocol: one fixture per card type, validation, versions and the agent.card event. */
import { describe, expect, it } from 'vitest';
import {
  CARD_TYPES,
  createEventBus,
  createManualClock,
  newId,
  parseCard,
  taalcutEventSchema,
  TimeoutError,
  unwrap,
  type Card,
  type CardType,
} from '@taalcut/core';
import { COST_ESTIMATE_V2, PHASE2_CARDS, runId } from './helpers/card-fixtures';
import { EDIT_CHANGES_CARD, PUBLISH_PACK_CARD } from './helpers/edt1-cards';
import { SOUND_RESULTS_CARD } from './helpers/ear1-cards';
import { PHASE3_CARDS } from './helpers/phase3-cards';

/** One fixture per type; the Record makes a new card type without a fixture a type error. */
const FIXTURES: { [T in CardType]: Extract<Card, { type: T }> } = {
  plan: {
    type: 'plan',
    version: 1,
    id: 'plan-1',
    runId,
    title: 'Cut a 30 s reel from Trip',
    steps: [
      { id: 's1', text: 'Add the Trip folder', status: 'done' },
      { id: 's2', text: 'Probe the first video', status: 'running' },
    ],
  },
  consent: {
    type: 'consent',
    version: 1,
    id: 'consent-1',
    runId,
    approvalId: 'ap-consent-1',
    tool: 'vision.describeFrame',
    upload: {
      modules: ['vision'],
      providers: ['google'],
      files: ['/Users/me/Movies/IMG_0418.mov'],
      sources: ['user-media'],
    },
    estimate: { money: { currency: 'USD', micros: 1_200 }, tokens: 1_800 },
    options: ['allow-once', 'always-allow', 'deny'],
    status: 'pending',
  },
  approval: {
    type: 'approval',
    version: 1,
    id: 'approval-1',
    runId,
    approvalId: 'ap-1',
    tool: 'library.removeSource',
    sideEffect: 'destructive',
    summary: 'Remove the Trip folder from the library',
    status: 'pending',
    expiresAt: 1_800_000_000_000,
  },
  costEstimate: {
    type: 'costEstimate',
    version: 1,
    id: 'cost-1',
    runId,
    tool: 'vision.describeFrame',
    estimate: { money: { currency: 'USD', micros: 12_500 }, tokens: 3_000, durationMs: 4_000 },
    remaining: { money: { currency: 'USD', micros: 240_000 } },
    requiresApproval: true,
    approvalId: 'ap-2',
  },
  error: {
    type: 'error',
    version: 1,
    id: 'error-1',
    error: { ...TimeoutError({ ms: 30_000 }), fix: { command: 'agent.retryStep', labelKey: 'fix.retry' } },
  },
  progress: {
    type: 'progress',
    version: 1,
    id: 'progress-1',
    jobId: newId<'Job'>(),
    labelKey: 'cards.progress.indexingLibrary',
    state: 'running',
    progress: { fraction: 0.42, completed: 42, total: 100, unit: 'items' },
  },
  toolRun: {
    type: 'toolRun',
    version: 1,
    id: 'tool-1',
    runId,
    toolRunId: newId<'ToolRun'>(),
    tool: 'media.probe',
    status: 'succeeded',
    startedAt: 1_000,
    finishedAt: 1_250,
    summary: '1080×1920, 29.97 fps, 42 s',
    artifactIds: ['artifact-1'],
  },
  ...PHASE2_CARDS,
  ...PHASE3_CARDS,
  memoryProposal: {
    type: 'memoryProposal',
    version: 1,
    id: 'memory:1',
    runId,
    approvalId: 'a1',
    text: 'Never use whip transitions.',
    scope: { kind: 'user' },
    scopeName: null,
    status: 'pending',
  },
  styleProfile: {
    type: 'styleProfile',
    version: 1,
    id: 'style-profile:1',
    runId,
    view: {
      source: { kind: 'instagram-collection', collectionId: 'col_inspo' },
      name: 'Travel inspo',
      profile: {
        algorithm: 'style-profile.v1',
        members: 1,
        pacing: {
          shot: { n: 4, q1: 0.8, median: 1.2, q3: 1.6 },
          cutsOnBeat: null,
          withBeats: 0,
          shotsInFirst3s: { n: 1, q1: 3, median: 3, q3: 3 },
        },
        hook: {
          shotType: [{ value: 'close', count: 1 }],
          duration: { n: 1, q1: 1, median: 1, q3: 1 },
          withText: 0,
          reveal: [],
          role: [],
          textExamples: [],
        },
        mix: { transitions: [{ value: 'cut', count: 3 }], slots: 4, speedRamps: 0, rampCurves: [] },
        overlays: {
          count: 0,
          withText: 0,
          position: [],
          size: [],
          reveal: [],
          case: [],
          background: [],
          wordsPerLine: null,
        },
        audio: { kind: [{ value: 'music', count: 1 }], loudnessLufs: null, energy: null },
        form: { length: { n: 1, q1: 4.8, median: 4.8, q3: 4.8 }, aspect: [{ value: '9:16', count: 1 }] },
        exemplars: [],
        exemplarPool: 0,
        exemplarIndex: null,
      },
      summary: { state: 'none', reason: 'no_model', at: 0 },
      exemplars: [],
      builtAt: 0,
    },
  },
  editChanges: EDIT_CHANGES_CARD,
  publishPack: PUBLISH_PACK_CARD,
  soundResults: SOUND_RESULTS_CARD,
};

describe('card protocol', () => {
  it('has a valid fixture for every card type', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...CARD_TYPES].sort());
    for (const card of Object.values(FIXTURES)) expect(unwrap(parseCard(card))).toEqual(card);
  });

  it('rejects unknown types and versions as unsupported, and bad shapes as validation errors', () => {
    const unknownType = parseCard({ type: 'poll', version: 1, id: 'x' });
    expect(!unknownType.ok && unknownType.error).toMatchObject({
      code: 'core.card_unsupported',
      params: { type: 'poll', version: '1' },
    });
    const newer = parseCard({ ...FIXTURES.plan, version: 2 });
    expect(!newer.ok && newer.error.code).toBe('core.card_unsupported');
    expect(!parseCard(null).ok).toBe(true);
    const badMoney = parseCard({
      ...FIXTURES.costEstimate,
      estimate: { money: { currency: 'usd', micros: 1.5 } },
    });
    expect(!badMoney.ok && badMoney.error).toMatchObject({
      code: 'core.validation',
      params: { field: 'estimate.money.currency' },
    });
  });

  it('knows both costEstimate versions and refuses a third', () => {
    expect(unwrap(parseCard(COST_ESTIMATE_V2))).toEqual(COST_ESTIMATE_V2);
    // A version-2 shape sent as version 1 is a bad version-1 card, not an unsupported one.
    const asV1 = parseCard({ ...COST_ESTIMATE_V2, version: 1 });
    expect(!asV1.ok && asV1.error.code).toBe('core.validation');
    const v3 = parseCard({ ...COST_ESTIMATE_V2, version: 3 });
    expect(!v3.ok && v3.error).toMatchObject({
      code: 'core.card_unsupported',
      params: { type: 'costEstimate', version: '3' },
    });
    const badLine = parseCard({
      ...COST_ESTIMATE_V2,
      lines: [{ ...COST_ESTIMATE_V2.lines[0], module: 'nope' }],
    });
    expect(!badLine.ok && badLine.error).toMatchObject({
      code: 'core.validation',
      params: { field: 'lines.0.module' },
    });
  });

  it('keeps flow and domain cards to their limits', () => {
    const timelineIds = Array.from({ length: 11 }, () => newId<'Timeline'>());
    expect(parseCard({ ...PHASE2_CARDS.castBoard, timelineIds }).ok).toBe(false);
    const asking = {
      ...PHASE2_CARDS.castBoard,
      castId: null,
      timelineIds: [],
      asking: { approvalId: 'ap-variants', suggested: 2, slotCount: 6 },
    };
    expect(unwrap(parseCard(asking))).toEqual(asking);
    const badSkill = { ...PHASE2_CARDS.step, step: { ...PHASE2_CARDS.step.step, skill: 'Not A Skill' } };
    expect(parseCard(badSkill).ok).toBe(false);
    expect(parseCard({ ...PHASE2_CARDS.exportApproval, presets: [] }).ok).toBe(false);
    expect(parseCard({ ...PHASE2_CARDS.openingChoices, paths: [] }).ok).toBe(false);
  });

  it('travels as an agent.card event', () => {
    const bus = createEventBus({ clock: createManualClock(7) });
    const seen: unknown[] = [];
    bus.on('agent.card', (event) => seen.push(taalcutEventSchema.parse(event)));
    bus.emit('agent.card', { runId, card: FIXTURES.approval });
    expect(seen).toEqual([{ type: 'agent.card', at: 7, payload: { runId, card: FIXTURES.approval } }]);
  });
});
