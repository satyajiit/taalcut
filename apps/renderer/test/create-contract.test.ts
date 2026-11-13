// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CREATION_COMMANDS as C,
  FrameRates,
  authoredInspectionSchema,
  creationProjectSchema,
  timelineSchema,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { buildModel } from '../src/features/timeline/model';
import { authoredLayerEdits } from '../src/features/timeline/authored/authored-layer-edits';
import { BRIEF, dispatchCreation, prepareCreation } from './create-support';

describe('creation contract through the renderer backend', () => {
  it('rejects production without approval, stale draft writes, and unanswered required questions', async () => {
    const { client } = createFakeBackend();
    const project = await prepareCreation(client);
    const target = { projectId: project.projectId, revision: project.revision };
    expect((await dispatchCreation(client, C.produce, target)).ok).toBe(false);
    expect((await dispatchCreation(client, C.research, target)).ok).toBe(true);
    const researched = await client.creation.get({ projectId: project.projectId });
    expect(
      (
        await dispatchCreation(client, C.approve, {
          ...target,
          revision: researched.revision,
          draftRevision: researched.draft!.revision,
        })
      ).ok,
    ).toBe(false);
    expect((await dispatchCreation(client, C.updateBrief, { ...target, brief: BRIEF })).ok).toBe(false);
    expect(creationProjectSchema.safeParse(researched).success).toBe(true);
  });

  it('returns editable authored timelines with retained source, source revision, motion and format', async () => {
    const { client } = createFakeBackend();
    const project = await prepareCreation(client, true);
    const projectId = project.projectId;
    expect(
      (
        await dispatchCreation(client, C.approve, {
          projectId,
          revision: project.revision,
          draftRevision: project.draft!.revision,
        })
      ).ok,
    ).toBe(true);
    const ready = await client.creation.get({ projectId });
    const timelineId = ready.timelineId!;
    const timeline = await client.timelines.get({ timelineId });
    expect(timelineSchema.safeParse(timeline).success).toBe(true);
    expect(timeline.canvas).toMatchObject({ width: 1920, height: 1080, rate: FrameRates.fps60 });
    expect(buildModel(timeline).positions.some((item) => item.item.type === 'program')).toBe(true);
    const inspect = await client.creation.inspect({ projectId, timelineId });
    expect(authoredInspectionSchema.safeParse(inspect).success).toBe(true);
    const target = inspect.elements[0]!.id;
    expect(
      (
        await dispatchCreation(client, C.editProgram, {
          projectId,
          timelineId,
          revision: timeline.revision,
          edits: [{ kind: 'text', target, text: 'Updated launch' }],
        })
      ).ok,
    ).toBe(true);
    const edited = await client.creation.inspect({ projectId, timelineId });
    expect(edited.elements[0]?.text).toBe('Updated launch');
    expect(edited.program.hash).not.toBe(inspect.program.hash);
    expect(
      (
        await dispatchCreation(client, C.editProgram, {
          projectId,
          timelineId,
          revision: timeline.revision,
          edits: [{ kind: 'remove', target }],
        })
      ).ok,
    ).toBe(false);
    expect((await client.projects.get({ projectId })).name).toBe(BRIEF.title);
  });

  it('preserves nested layers and inherited CSS while removing only explicit deleted overrides', () => {
    const element = {
      id: '#card',
      parentId: null,
      tag: 'div',
      text: null,
      styles: { color: 'red', opacity: '1' },
      attributes: { id: 'card', title: 'Old' },
      start: null,
      duration: null,
      animationIds: [],
    };
    const edits = authoredLayerEdits(element, {
      text: '',
      styles: '{"color":"blue"}',
      attributes: '{"id":"card"}',
      order: 0,
    });
    expect(edits).toEqual([
      { kind: 'style', target: '#card', styles: { color: 'blue', opacity: null } },
      { kind: 'attribute', target: '#card', name: 'title', value: null },
    ]);
    expect(() =>
      authoredLayerEdits(element, { text: '', styles: '[]', attributes: '{}', order: 0 }),
    ).toThrow();
  });
});
