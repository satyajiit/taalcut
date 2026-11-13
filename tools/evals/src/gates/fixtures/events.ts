// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { telemetryEnvelopeSchema, type TelemetryEnvelope } from '@taalcut/core';
import { type LanguageName } from '../slices';

export interface EventSeed {
  installId: string;
  sessionId: string;
  cohort?: string;
  at: number;
  seq: number;
}

function frame(seed: EventSeed, event: TelemetryEnvelope['event']): TelemetryEnvelope {
  return telemetryEnvelopeSchema.parse({
    v: 1,
    installId: seed.installId,
    sessionId: seed.sessionId,
    ...(seed.cohort === undefined ? {} : { cohort: seed.cohort }),
    seq: seed.seq,
    at: seed.at,
    event,
  });
}

export function sessionStarted(seed: EventSeed, locale: LanguageName): TelemetryEnvelope {
  return frame(seed, {
    name: 'session.started',
    appVersion: '0.9.0',
    channel: 'beta',
    osMajor: 15,
    tier: 'minimum',
    locale,
    profile: 'balanced',
  });
}

export function exportCompleted(
  seed: EventSeed,
  input: { firstExport: boolean; slots: number; kept: number; orderChanged: boolean },
): TelemetryEnvelope {
  return frame(seed, {
    name: 'export.completed',
    firstExport: input.firstExport,
    path: 'template',
    preset: 'reels',
    musicPath: 'ownTrack',
    slots: input.slots,
    slotsKeptAi: input.kept,
    slotsSwappedByUser: input.slots - input.kept,
    orderChanged: input.orderChanged,
    breakdownEdited: false,
    seconds: 30,
    renderMs: 1_000,
  });
}

export function onboardingStep(seed: EventSeed, ms: number): TelemetryEnvelope {
  return frame(seed, { name: 'onboarding.step', step: 'import', ms, skipped: false });
}

export function onboardingFirstExport(seed: EventSeed, ms: number): TelemetryEnvelope {
  return frame(seed, { name: 'onboarding.firstExport', ms, start: 'template' });
}

export function qaResult(seed: EventSeed, firstPass: boolean): TelemetryEnvelope {
  return frame(seed, {
    name: 'qa.result',
    passed: firstPass,
    firstPass,
    fixLoops: firstPass ? 0 : 1,
    failed: [],
  });
}

export function renderFinished(seed: EventSeed, kind: 'export' | 'draft'): TelemetryEnvelope {
  return frame(seed, { name: 'render.finished', kind, status: 'ready' });
}

export function costRecorded(
  seed: EventSeed,
  input: { usdMicros: number; billing: 'apiKey' | 'subscription'; scope: 'export' | 'abandoned' },
): TelemetryEnvelope {
  return frame(seed, {
    name: 'cost.recorded',
    scope: input.scope,
    usdMicros: input.usdMicros,
    estimateMicros: input.usdMicros,
    byModule: {},
    capHit: false,
    billing: input.billing,
  });
}

export function feedbackSent(seed: EventSeed): TelemetryEnvelope {
  return frame(seed, { name: 'feedback.sent', withBundle: false, withChatText: false });
}
