// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { CancelledError, err, newId, ok, unwrap, ValidationError } from '@taalcut/core';
import { expect, it } from 'vitest';
import { createShortsService } from '../src';
import { fixtures } from './helpers';

it('does not compose a persisted review plan after an interrupted status write', async () => {
  const setup = fixtures();
  const failed = createShortsService({
    ...setup.deps,
    compose: async () => err(ValidationError({ field: 'render' })),
  });
  await failed.generate(setup.request);
  const run = [...setup.runs.values()][0]!;
  setup.runs.set(run.id, {
    ...run,
    status: 'running',
    stage: 'composing',
    issues: ['Meaning is unresolved.'],
  });
  const recovered = unwrap(await createShortsService(setup.deps).generate(setup.request, { runId: run.id }));
  expect(recovered).toMatchObject({ status: 'needsReview', stage: 'editorialReview' });
  expect(setup.compose).not.toHaveBeenCalled();
});

it('refuses a saved plan after the source analysis changes', async () => {
  const setup = fixtures();
  await createShortsService({
    ...setup.deps,
    compose: async () => err(ValidationError({ field: 'render' })),
  }).generate(setup.request);
  const run = [...setup.runs.values()][0]!;
  expect(run.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  const original = unwrap(await setup.deps.source.describe(setup.assetId));
  const resumed = createShortsService({
    ...setup.deps,
    source: {
      ...setup.deps.source,
      describe: async () => ok({ ...original, analysisVersion: 'changed-transcript' }),
    },
  });
  expect(unwrap(await resumed.generate(setup.request, { runId: run.id }))).toMatchObject({
    status: 'needsReview',
    stage: 'sourceChanged',
  });
  expect(setup.compose).not.toHaveBeenCalled();
});

it('retains render QA issues instead of declaring the short ready', async () => {
  const setup = fixtures();
  const renderId = newId<'Render'>();
  const service = createShortsService({
    ...setup.deps,
    compose: async () =>
      ok({
        timelineId: newId<'Timeline'>(),
        revision: 3,
        renderIds: [renderId],
        issues: ['Caption intersects source title.'],
      }),
  });
  const run = unwrap(await service.generate(setup.request));
  expect(run).toMatchObject({
    status: 'needsReview',
    renderIds: [renderId],
    issues: ['Caption intersects source title.'],
  });
});

it('resumes cancelled verification without repeating completed source analysis', async () => {
  const setup = fixtures();
  const controller = new AbortController();
  const original = setup.deps.models.complete;
  let attempts = 0;
  const interrupted = createShortsService({
    ...setup.deps,
    models: {
      complete: async (request, signal) => {
        attempts++;
        if (attempts === 2) {
          controller.abort();
          return err(CancelledError());
        }
        return original(request, signal);
      },
    },
  });
  expect((await interrupted.generate(setup.request, { signal: controller.signal })).ok).toBe(false);
  const run = [...setup.runs.values()][0]!;
  expect(run.status).toBe('cancelled');
  expect(setup.compose).not.toHaveBeenCalled();
  const resumed = unwrap(await createShortsService(setup.deps).generate(setup.request, { runId: run.id }));
  expect(resumed.status).toBe('ready');
  expect(
    setup.calls.filter((call) => call.system.includes('identifying complete short stories')),
  ).toHaveLength(1);
});
