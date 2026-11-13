// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, type TelemetryEnvelope } from '@taalcut/core';
import { type LanguageName } from '../slices';
import {
  costRecorded,
  exportCompleted,
  feedbackSent,
  onboardingFirstExport,
  onboardingStep,
  qaResult,
  renderFinished,
  sessionStarted,
} from './events';
import { COHORT_CODE, DAY_MS, GROUND, MINUTE_MS, T0, type FixtureNumbers } from './ground';

interface Plan {
  installId: string;
  sessionId: string;
  cohort: string;
  locale: LanguageName;
  activated: boolean;
  retained: boolean;
}

function plans(
  count: number,
  cohort: string,
  localeAt: (index: number) => LanguageName,
  activated: number,
  retained: number,
): Plan[] {
  return Array.from({ length: count }, (_, index) => ({
    installId: newId<'Install'>(),
    sessionId: newId<'TelemetrySession'>(),
    cohort,
    locale: localeAt(index),
    activated: index < activated,
    retained: index < retained,
  }));
}

function installEvents(plan: Plan, numbers: FixtureNumbers): TelemetryEnvelope[] {
  const envelopes: TelemetryEnvelope[] = [];
  let seq = 0;
  const seed = () => ({
    installId: plan.installId,
    sessionId: plan.sessionId,
    cohort: plan.cohort,
  });
  envelopes.push(sessionStarted({ ...seed(), at: T0, seq: seq }, plan.locale));
  seq += 1;
  envelopes.push(onboardingStep({ ...seed(), at: T0, seq }, MINUTE_MS));
  seq += 1;
  if (plan.activated) {
    const at = T0 + numbers.minutes * MINUTE_MS;
    envelopes.push(onboardingFirstExport({ ...seed(), at, seq }, numbers.minutes * MINUTE_MS));
    seq += 1;
  }
  for (let index = 0; index < numbers.exportsEach; index += 1) {
    envelopes.push(
      exportCompleted(
        { ...seed(), at: T0 + numbers.minutes * MINUTE_MS + index * 1_000, seq },
        {
          firstExport: plan.activated && index === 0,
          slots: GROUND.slots.slots,
          kept: numbers.kept,
          orderChanged: numbers.orderChanged,
        },
      ),
    );
    seq += 1;
  }
  if (plan.retained) {
    envelopes.push(feedbackSent({ ...seed(), at: T0 + GROUND.retentionDays * DAY_MS, seq }));
  }
  return envelopes;
}

function sideEvents(plan: Plan, numbers: FixtureNumbers): TelemetryEnvelope[] {
  const envelopes: TelemetryEnvelope[] = [];
  const base = { installId: plan.installId, sessionId: plan.sessionId, cohort: plan.cohort };
  let seq = 100;
  for (let index = 0; index < GROUND.qa.n; index += 1) {
    envelopes.push(qaResult({ ...base, at: T0 + 3 * 3_600_000 + index, seq }, index < numbers.qaFirst));
    seq += 1;
  }
  for (let index = 0; index < GROUND.renders.n; index += 1) {
    envelopes.push(
      renderFinished(
        { ...base, at: T0 + 4 * 3_600_000 + index, seq },
        index < numbers.renderReady ? 'export' : 'draft',
      ),
    );
    seq += 1;
  }
  for (let index = 0; index < GROUND.cost.n; index += 1) {
    envelopes.push(
      costRecorded(
        { ...base, at: T0 + 5 * 3_600_000 + index, seq },
        { usdMicros: numbers.costMicros, billing: 'apiKey', scope: 'export' },
      ),
    );
    seq += 1;
  }
  envelopes.push(
    costRecorded(
      { ...base, at: T0 + 6 * 3_600_000, seq },
      { usdMicros: GROUND.cost.ignoredMicros, billing: 'subscription', scope: 'export' },
    ),
  );
  envelopes.push(
    costRecorded(
      { ...base, at: T0 + 6 * 3_600_000 + 1, seq: seq + 1 },
      { usdMicros: GROUND.cost.ignoredMicros, billing: 'apiKey', scope: 'abandoned' },
    ),
  );
  return envelopes;
}

export function buildTelemetry(numbers: FixtureNumbers): TelemetryEnvelope[] {
  const fresh = plans(
    GROUND.activation.freshBeta.installs,
    COHORT_CODE.freshBeta,
    () => 'en',
    numbers.freshActivated,
    0,
  );
  const beta = plans(GROUND.activation.beta.installs, COHORT_CODE.beta, () => 'hi', numbers.betaActivated, 0);
  const alpha = plans(
    GROUND.alpha.installs,
    COHORT_CODE.alpha,
    (index) => (index < GROUND.alpha.installs / 2 ? 'es' : 'pt-BR'),
    GROUND.alpha.installs,
    numbers.alphaRetained,
  );
  const cohort = [...fresh, ...beta, ...alpha];
  const first = cohort[0];
  if (first === undefined) throw new Error('fixture cohort is empty');
  return [...cohort.flatMap((plan) => installEvents(plan, numbers)), ...sideEvents(first, numbers)];
}
