// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  CREATION_COMMANDS,
  err,
  newId,
  NotFoundError,
  unwrap,
  type CreationProject,
  type CreationSource,
  type CreationTask,
} from '@taalcut/core';
import { createRepositories } from '@taalcut/library';
import {
  CREATION_CHECKPOINT,
  creationCheckpointCommand,
  creationCheckpointSchema,
  creationCheckpointStore,
} from '../src/utility/creation/checkpoints';
import { AGENT, creationWorld, draftProject, UI, type CreationWorld } from './helpers/creation';

function setup() {
  const world = creationWorld();
  if (!world.bus.list().some((command) => command.name === CREATION_CHECKPOINT))
    world.bus.register(creationCheckpointCommand(world.container));
  return { ...world, checkpoints: creationCheckpointStore(world.container, world.store) };
}

function task(key: string, artifact: string | null = null): CreationTask {
  return {
    id: newId<'CreationTask'>(),
    key,
    inputRevision: 1,
    costMicros: 0,
    tokens: 0,
    parentId: null,
    role: 'designer',
    status: 'running',
    progress: 0,
    message: key,
    artifact,
  };
}

function source(): CreationSource {
  return {
    id: newId<'CreationSource'>(),
    kind: 'url',
    label: 'Website',
    url: 'https://example.com',
    status: 'ready',
    content: `CAPTURE:${'y'.repeat(90_000)}`,
    evidence: [],
    assetIds: [newId<'Asset'>()],
  };
}

function next(before: CreationProject, patch: Partial<CreationProject>): CreationProject {
  return { ...before, ...patch, revision: before.revision + 1, updatedAt: before.updatedAt + 1 };
}

function audits(world: CreationWorld, projectId: CreationProject['projectId']) {
  return unwrap(createRepositories(world.db).auditLog.listByProject(projectId)).filter(
    (entry) => entry.name === CREATION_CHECKPOINT,
  );
}

describe('Create delta checkpoints', () => {
  it('audits only changed fields and reopens the exact full durable project', async () => {
    const world = setup();
    const initial = await draftProject(world);
    unwrap(
      await world.bus.dispatch(
        CREATION_COMMANDS.answer,
        {
          projectId: initial.projectId,
          revision: initial.revision,
          draftRevision: initial.draft!.revision,
          answers: [],
        },
        UI,
      ),
    );
    const before = unwrap(await world.store.get(initial.projectId));
    const first = next(before, {
      tasks: [task('scene:one', `ARTIFACT:${'x'.repeat(600_000)}`), task('scene:two')],
      sources: [source()],
      status: 'producing',
      publicationBase: [{ timelineId: newId<'Timeline'>(), revision: 3 }],
    });
    const history = unwrap(await world.bus.history(before.projectId));
    unwrap(await world.checkpoints.save(first, before.revision));
    const second = next(first, {
      tasks: first.tasks.map((entry, index) => ({ ...entry, progress: index ? 0.25 : 0.75 })),
      sources: first.sources.map((entry) => ({ ...entry, label: 'Product website' })),
      budget: { ...first.budget, spentMicros: 100 },
    });
    unwrap(await world.checkpoints.save(second, first.revision));
    expect(unwrap(await world.store.get(before.projectId))).toEqual(second);
    const entries = audits(world, before.projectId);
    expect(entries).toHaveLength(2);
    const payload = creationCheckpointSchema.parse(entries[1]!.payload);
    expect(payload.tasks?.changes.map((change) => change.patch)).toEqual([
      { progress: 0.75 },
      { progress: 0.25 },
    ]);
    expect(payload.tasks).not.toHaveProperty('order');
    expect(payload.sources?.changes[0]!.patch).toEqual({ label: 'Product website' });
    expect(payload.sources).not.toHaveProperty('order');
    const encoded = JSON.stringify(entries[1]);
    expect(encoded.length).toBeLessThan(2000);
    expect(encoded).not.toContain('ARTIFACT:');
    expect(encoded).not.toContain('CAPTURE:');
    expect(entries.every((entry) => entry.inverse === null && entry.result === null)).toBe(true);
    expect(unwrap(await world.bus.history(before.projectId)).undo).toBe(history.undo);
    world.db.close();
    const reopened = creationWorld(world.userData);
    expect(unwrap(await reopened.store.get(before.projectId))).toEqual(second);
    expect(unwrap(await reopened.store.list())).toEqual([second]);
  });

  it('round-trips insertion, deletion, reordering and explicit optional field removal', async () => {
    const world = setup();
    const before = await draftProject(world);
    const first = next(before, {
      tasks: [task('one'), task('two')],
      sources: [source(), source()],
      publicationBase: [{ timelineId: newId<'Timeline'>(), revision: 2 }],
    });
    unwrap(await world.checkpoints.save(first, before.revision));
    const retainedSource = { ...first.sources[1]! };
    delete retainedSource.content;
    const second = next(first, {
      tasks: [first.tasks[1]!, task('three'), first.tasks[0]!],
      sources: [retainedSource],
    });
    delete second.publicationBase;
    unwrap(await world.checkpoints.save(second, first.revision));
    const payload = creationCheckpointSchema.parse(audits(world, before.projectId).at(-1)!.payload);
    expect(payload.tasks?.order).toEqual(second.tasks.map((entry) => entry.id));
    expect(payload.tasks?.changes).toHaveLength(1);
    expect(payload.sources?.order).toEqual([retainedSource.id]);
    expect(payload.sources?.changes[0]!.unset).toEqual(['content']);
    expect(payload.unsetMetadata).toEqual(['publicationBase']);
    expect(unwrap(await world.store.get(before.projectId))).toEqual(second);
    const cleared = next(second, { tasks: [], sources: [] });
    unwrap(await world.checkpoints.save(cleared, second.revision));
    expect(unwrap(await world.store.get(before.projectId))).toEqual(cleared);
  });

  it('refuses forged identities, invalid row edits and stale revisions without an audit row', async () => {
    const world = setup();
    const before = await draftProject(world);
    const first = next(before, { tasks: [task('one')], sources: [source()] });
    unwrap(await world.checkpoints.save(first, before.revision));
    const id = first.tasks[0]!.id;
    const unknown = newId<'CreationTask'>();
    const base = { projectId: first.projectId, expectedRevision: first.revision };
    const forged = [
      { metadata: { projectId: newId<'Project'>() } },
      { metadata: { revision: first.revision + 10 } },
      { metadata: { createdAt: 0 } },
      { tasks: { changes: [{ id, patch: { id: unknown } }] } },
      { tasks: { changes: [{ id: unknown, patch: { progress: 0.5 } }] } },
      { tasks: { changes: [], order: [unknown] } },
      { tasks: { changes: [], order: [id, id] } },
      {
        tasks: {
          changes: [
            { id, patch: { progress: 0.5 } },
            { id, patch: { progress: 0.6 } },
          ],
        },
      },
      { tasks: { changes: [{ id: unknown, patch: { progress: 0.5 } }], order: [id, unknown] } },
      { sources: { changes: [{ id: first.sources[0]!.id, patch: {}, unset: ['url'] }] } },
      { sources: { changes: [{ id: first.sources[0]!.id, patch: { assetIds: undefined } }] } },
      { metadata: { publicationBase: [] }, unsetMetadata: ['publicationBase'] },
    ];
    for (const patch of forged)
      expect((await world.bus.dispatch(CREATION_CHECKPOINT, { ...base, ...patch }, AGENT)).ok).toBe(false);
    const stale = await world.checkpoints.save(next(first, { status: 'ready' }), before.revision);
    expect(!stale.ok && ConflictError.is(stale.error)).toBe(true);
    const staleCommand = await world.bus.dispatch(
      CREATION_CHECKPOINT,
      {
        ...base,
        expectedRevision: before.revision,
        metadata: { status: 'ready' },
      },
      AGENT,
    );
    expect(!staleCommand.ok && ConflictError.is(staleCommand.error)).toBe(true);
    expect((await world.checkpoints.save({ ...next(first, {}), createdAt: 0 }, first.revision)).ok).toBe(
      false,
    );
    expect((await world.bus.dispatch(CREATION_CHECKPOINT, base, UI)).ok).toBe(false);
    expect(unwrap(await world.store.get(first.projectId))).toEqual(first);
    expect(audits(world, first.projectId)).toHaveLength(1);
  });

  it('rolls back a failed audit and preserves storage errors through the adapter', async () => {
    const world = setup();
    const before = await draftProject(world);
    const after = next(before, { tasks: [task('one')], status: 'producing' });
    world.db.driver.exec(
      "CREATE TRIGGER reject_creation_checkpoint BEFORE INSERT ON commands WHEN NEW.name='creation.checkpoint' BEGIN SELECT RAISE(ABORT, 'audit refused'); END",
    );
    expect((await world.checkpoints.save(after, before.revision)).ok).toBe(false);
    expect(unwrap(await world.store.get(before.projectId))).toEqual(before);
    expect(audits(world, before.projectId)).toHaveLength(0);
    world.db.driver.exec('DROP TRIGGER reject_creation_checkpoint');
    unwrap(await world.checkpoints.save(after, before.revision));
    expect(unwrap(await world.store.get(before.projectId))).toEqual(after);
    const failure = err(NotFoundError({ entity: 'creationProject', id: before.projectId }));
    const failing = creationCheckpointStore(world.container, { ...world.store, get: async () => failure });
    expect(await failing.save(next(after, {}), after.revision)).toBe(failure);
  });
});
