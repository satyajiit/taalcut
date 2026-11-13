// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Fixtures for Phase 3's cards (round P3-1); cards.test.ts spreads them into its one-per-type table. */
import { FrameRates, newId, RationalTime, type CardOf } from '@taalcut/core';
import { runId, step } from './card-fixtures';

const projectId = newId<'Project'>();
const timelineId = newId<'Timeline'>();
const usd = (micros: number) => ({ currency: 'USD', micros });
const at = (frames: number) => ({ value: frames, rate: FrameRates.fps30 });

type Phase3Type =
  | 'rateLimit'
  | 'variantsCompare'
  | 'gapFix'
  | 'hubResults'
  | 'cleanupPlan'
  | 'styleBatch'
  | 'voiceover'
  | 'voiceConsent'
  | 'motionGraphic'
  | 'renderBatch'
  | 'imageTakes';

const batchId = newId<'RenderBatch'>();

export const PHASE3_CARDS: { [T in Phase3Type]: CardOf<T> } = {
  rateLimit: {
    type: 'rateLimit',
    version: 1,
    id: 'limit-1',
    runId,
    module: 'agent',
    reason: 'rate',
    status: 'waiting',
    from: { provider: 'openai', model: 'gpt-5.2' },
    resetsAt: 1_800_000_000_000,
    approvalId: 'ap-limit',
    options: [
      { provider: 'anthropic', model: 'claude-sonnet-5', local: false, estimate: usd(20_000) },
      { provider: 'taalcut', model: 'qwen3.5-4b', local: true },
    ],
  },
  variantsCompare: {
    type: 'variantsCompare',
    version: 1,
    id: 'variants-1',
    runId,
    step,
    projectId,
    castId: newId<'Cast'>(),
    baseTimelineId: timelineId,
    baseRevision: 3,
    status: 'ready',
    variants: [
      {
        index: 1,
        revision: 1,
        timelineId: newId<'Timeline'>(),
        hookChanged: true,
        picksChanged: 0.4,
        music: null,
        captionPreset: 'bold',
      },
    ],
    asked: 2,
    short: { axis: 'hook', asked: 2, made: 1 },
  },
  gapFix: {
    type: 'gapFix',
    version: 1,
    id: 'gaps-1',
    runId,
    projectId,
    timelineId,
    revision: 4,
    gaps: [
      {
        gapId: newId<'TimelineItem'>(),
        slotId: newId<'TemplateSlot'>(),
        number: 3,
        start: at(90),
        duration: at(60),
        intent: { text: 'A close-up of the coffee pour', shotType: 'close', motion: null, energy: 0.6 },
        note: 'noCandidates',
        options: [
          { kind: 'film' },
          {
            kind: 'generate',
            provider: 'google',
            model: 'imagen-4',
            estimate: usd(40_000),
            prompt: 'Coffee poured into a white cup, morning light',
          },
          { kind: 'drop', newDuration: at(840) },
        ],
        unavailable: [{ kind: 'stock', reason: 'noStockKey' }],
        outcome: 'open',
      },
    ],
    asking: { approvalId: 'ap-gaps' },
  },
  hubResults: {
    type: 'hubResults',
    version: 1,
    id: 'hub-1',
    runId,
    query: 'cafe vlog',
    sort: 'topRated',
    items: [
      {
        id: newId<'HubTemplate'>(),
        version: 2,
        name: 'Morning café',
        handle: 'mira.cuts',
        language: 'en',
        formatId: 'vlog',
        trendFreshness: '2026-10-01',
        duration: at(900),
        slotCount: 8,
        bpm: 104,
        slotStrip: [90, 120, 90, 150, 90, 120, 120, 120],
        sha256: 'a'.repeat(64),
        updatedAt: 1_700_000_000_000,
        rating: { count: 12, mean: 4.5 },
        forkedAs: null,
      },
    ],
    indexFetchedAt: 1_700_000_000_000,
  },
  cleanupPlan: {
    type: 'cleanupPlan',
    version: 1,
    id: 'cleanup-1',
    runId,
    projectId,
    plan: {
      timelineId,
      revision: 2,
      clips: [
        {
          clipId: newId<'TimelineItem'>(),
          keep: [
            { start: at(0), duration: at(45) },
            { start: at(60), duration: at(90) },
          ],
          newIds: [newId<'TimelineItem'>()],
          punch: [
            {
              range: { start: at(60), duration: at(30) },
              reframe: { mode: 'subject', nudge: { x: 0, y: 0 }, scale: 1.1 },
            },
          ],
        },
      ],
      stats: { fillers: 3, pauses: 2, retakes: 0, punchIns: 1, secondsSaved: 2.5 },
    },
    before: 42,
    after: 39.5,
    status: 'proposed',
  },
  styleBatch: {
    type: 'styleBatch',
    version: 1,
    id: 'style-batch-1',
    runId,
    apply: { kind: 'style', styleId: newId<'Style'>(), name: 'Warm film', styleKind: 'look' },
    applied: [{ projectId, timelineId }],
    skipped: [{ projectId: newId<'Project'>(), timelineId: newId<'Timeline'>(), reason: 'changedSince' }],
    commandId: newId<'Command'>(),
  },
  voiceover: {
    type: 'voiceover',
    version: 1,
    id: 'voice-1',
    runId,
    projectId,
    timelineId,
    voiceover: {
      id: newId<'Voiceover'>(),
      voiceName: 'Ana',
      own: false,
      language: 'pt-BR',
      lines: [
        {
          id: newId<'VoiceLine'>(),
          text: 'Primeiro, o café.',
          slotId: null,
          clipId: null,
          assetId: null,
          quality: 'draft',
          duration: RationalTime.of(42, FrameRates.fps30),
          offBeat: false,
        },
      ],
    },
    quality: 'draft',
    spent: usd(8_000),
    finalizeEstimate: usd(30_000),
    ducking: { enabled: true, minMarginLu: 9 },
  },
  voiceConsent: {
    type: 'voiceConsent',
    version: 1,
    id: 'consent-voice-1',
    consentId: newId<'VoiceConsent'>(),
    termsVersion: '1',
    language: 'en',
    status: 'mismatch',
    heard: 'I am Mira and I agree',
  },
  motionGraphic: {
    type: 'motionGraphic',
    version: 1,
    id: 'graphic-1',
    projectId,
    timelineId,
    itemId: newId<'TimelineItem'>(),
    composition: { id: newId<'GraphicComposition'>(), name: 'Made-up counter' },
    start: RationalTime.of(120, FrameRates.fps30),
    duration: RationalTime.of(60, FrameRates.fps30),
    unmatched: ['fifty percent'],
  },
  renderBatch: {
    type: 'renderBatch',
    version: 1,
    id: 'batch-1',
    runId,
    progress: {
      batchId,
      total: 2,
      queued: 0,
      running: 1,
      ready: 1,
      needsAttention: 0,
      failed: 0,
      cancelled: 0,
      etaMs: 40_000,
    },
    items: [
      { projectId, timelineId, renderId: newId<'Render'>(), presetId: 'reels', status: 'ready' },
      {
        projectId,
        timelineId: newId<'Timeline'>(),
        renderId: null,
        presetId: 'landscape',
        status: 'running',
      },
    ],
  },
  imageTakes: {
    type: 'imageTakes',
    version: 1,
    id: 'takes-1',
    runId,
    projectId,
    timelineId,
    slotId: newId<'TemplateSlot'>(),
    takes: [
      { assetId: newId<'Asset'>(), provider: 'google', model: 'imagen-4', thumbnailArtifactId: 'artifact-7' },
    ],
    placed: null,
    spent: usd(40_000),
  },
};

export { batchId };
