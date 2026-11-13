// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, ok } from '@taalcut/core';
import { expect, it, vi } from 'vitest';
import { creationFixture } from './fixture';

it('revises answered claims before preview and carries answers and verified logos into production', async () => {
  const f = creationFixture();
  await f.director().prepare(f.projectId);
  const draft = f.get().draft!;
  const revised = {
    ...draft,
    revision: draft.revision + 1,
    answersPending: true,
    visualPreviewAssetId: null,
    title: 'Manual title',
    questions: [{ id: 'date', prompt: 'Launch date?', required: true, answer: 'November 11' }],
  };
  const logo = JSON.stringify([{ name: 'Example', sourceUrl: 'https://svgl.app', svg: '<svg/>' }]);
  f.set({
    ...f.get(),
    draft: revised,
    status: 'draft',
    tasks: [
      {
        id: newId<'CreationTask'>(),
        key: 'brand:logos',
        role: 'researcher',
        inputRevision: revised.revision,
        costMicros: 0,
        tokens: 0,
        parentId: null,
        status: 'completed',
        progress: 1,
        message: 'Brand',
        artifact: logo,
      },
    ],
  });
  const complete = f.deps.model.complete;
  const priorCalls = f.calls.length;
  f.deps.model.complete = vi.fn(async (request) => {
    if (request.role !== 'writer') return complete(request);
    f.calls.push(request);
    expect(JSON.parse(request.prompt).currentDraft).toMatchObject({
      title: 'Manual title',
      questions: revised.questions,
    });
    return ok({
      text: JSON.stringify({
        ...revised,
        beats: revised.beats.map((beat) => ({ ...beat, screenText: 'November 11' })),
      }),
      usageMicros: 50,
      tokens: 20,
    });
  });
  expect((await f.director().prepare(f.projectId)).ok).toBe(true);
  expect(f.get().draft).toMatchObject({
    title: 'Manual title',
    answersPending: false,
    visualPreviewAssetId: f.assetId,
  });
  expect(f.get().draft!.beats[0]!.screenText).toBe('November 11');
  const count = f.calls.filter((call) => call.role === 'writer').length;
  await f.director().prepare(f.projectId);
  expect(f.calls.filter((call) => call.role === 'writer')).toHaveLength(count);
  f.approve();
  expect((await f.director().produce(f.projectId)).ok).toBe(true);
  const designs = f.calls.slice(priorCalls).filter((call) => call.role === 'designer');
  expect(designs.length).toBeGreaterThan(2);
  for (const call of designs) {
    expect(JSON.parse(call.prompt)).toMatchObject({ answers: revised.questions, logos: logo });
    expect(JSON.parse(call.prompt).motionContract).not.toBeNull();
  }
});
