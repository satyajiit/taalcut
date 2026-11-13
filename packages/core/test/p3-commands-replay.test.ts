// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Round P3-3, the command bus: a handler knows when it runs as a redo (also after a restart), undo and redo
 * answer what they ran returned, and `library.changed` waits for the commit in one shared helper.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  batchStyleResultSchema,
  ConflictError,
  createCommandBus,
  createCommitAnnouncer,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  defineCommand,
  err,
  newId,
  ok,
  unwrap,
  type AuditLogStore,
  type CommandContext,
  type CommandListener,
  type CommandReplay,
  type ProjectId,
  type TaalcutEvent,
} from '@taalcut/core';
import { UI } from './helpers/bus';

/** A document whose writes name the revision they were computed against, as timeline writes do. */
function revisedDocument(store: AuditLogStore) {
  const doc = { revision: 1, text: '' };
  const seen: { name: string; replay: CommandReplay | undefined }[] = [];
  const record = (name: string, context: CommandContext) => seen.push({ name, replay: context.replay });
  const append = defineCommand({
    name: 'doc.append',
    payload: z.object({ projectId: z.string(), revision: z.int(), text: z.string() }),
    sideEffect: 'write',
    handle: ({ revision, text }, context) => {
      record('doc.append', context);
      if (revision !== doc.revision && context.replay !== 'redo')
        return err(ConflictError({ entity: 'doc', id: 'doc' }));
      const before = doc.text;
      doc.text += text;
      doc.revision += 1;
      return ok({
        result: { revision: doc.revision },
        inverse: { name: 'doc.restore', payload: { projectId: context.projectId, text: before } },
      });
    },
  });
  const restore = defineCommand({
    name: 'doc.restore',
    payload: z.object({ projectId: z.string(), text: z.string() }),
    sideEffect: 'write',
    internal: true,
    handle: ({ text }, context) => {
      record('doc.restore', context);
      doc.text = text;
      doc.revision += 1;
      return ok({ result: { revision: doc.revision, restored: true } });
    },
  });
  const bus = () => {
    const created = createCommandBus({ store, clock: createManualClock(0) });
    created.register(append, restore);
    return created;
  };
  return { doc, seen, bus, append };
}

describe('redo context', () => {
  it("tells the handler it runs as a redo, so a payload's revision from before the undo is no conflict", async () => {
    const store = createMemoryAuditLogStore();
    const { doc, seen, bus: makeBus, append } = revisedDocument(store);
    const bus = makeBus();
    const projectId = newId<'Project'>();
    unwrap(await bus.dispatch(append, { projectId, revision: 1, text: 'Goa' }, UI));
    unwrap(await bus.undo(projectId, UI));
    expect(doc).toEqual({ revision: 3, text: '' });
    unwrap(await bus.redo(projectId, UI));
    expect(doc).toEqual({ revision: 4, text: 'Goa' });

    // A new bus on the same log: the redo stack comes from the log, and the redo is still a replay.
    unwrap(await bus.undo(projectId, UI));
    const restarted = makeBus();
    unwrap(await restarted.redo(projectId, UI));
    expect(doc.text).toBe('Goa');
    expect(seen).toEqual([
      { name: 'doc.append', replay: undefined },
      { name: 'doc.restore', replay: undefined },
      { name: 'doc.append', replay: 'redo' },
      { name: 'doc.restore', replay: undefined },
      { name: 'doc.append', replay: 'redo' },
    ]);
    // A fresh dispatch with the stale revision is still refused.
    const stale = await restarted.dispatch(append, { projectId, revision: 1, text: '!' }, UI);
    expect(!stale.ok && ConflictError.is(stale.error)).toBe(true);
  });

  it('runs a rollback after a failed redo as a plain execution', async () => {
    const memory = createMemoryAuditLogStore();
    const failing: AuditLogStore = {
      ...memory,
      markRedone: async () => err(ConflictError({ entity: 'audit', id: 'x' })),
    };
    const { seen, bus: makeBus, append } = revisedDocument(failing);
    const bus = makeBus();
    const projectId = newId<'Project'>();
    unwrap(await bus.dispatch(append, { projectId, revision: 1, text: 'Goa' }, UI));
    unwrap(await bus.undo(projectId, UI));
    expect((await bus.redo(projectId, UI)).ok).toBe(false);
    expect(seen.slice(-2)).toEqual([
      { name: 'doc.append', replay: 'redo' },
      { name: 'doc.restore', replay: undefined },
    ]);
  });
});

describe('undo and redo receipts', () => {
  it('carry what the inverse or the re-run returned, and nothing when it returned nothing', async () => {
    const store = createMemoryAuditLogStore();
    const { bus: makeBus, append } = revisedDocument(store);
    const bus = makeBus();
    const projectId = newId<'Project'>();
    const done = unwrap(await bus.dispatch(append, { projectId, revision: 1, text: 'Goa' }, UI));
    expect(unwrap(await bus.undo(projectId, UI))).toEqual({
      id: done.id,
      name: 'doc.append',
      projectId,
      result: { revision: 3, restored: true },
    });
    expect(unwrap(await bus.redo(projectId, UI))).toMatchObject({ id: done.id, result: { revision: 4 } });

    const silent = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(0) });
    const toggle = defineCommand({
      name: 'app.toggle',
      payload: z.object({}),
      sideEffect: 'write',
      project: () => null,
      handle: () => ok({ result: undefined, inverse: { name: 'app.toggle', payload: {} } }),
    });
    silent.register(toggle);
    unwrap(await silent.dispatch(toggle, {}, UI));
    expect('result' in (unwrap(await silent.undo(null, UI)) ?? {})).toBe(false);
  });

  it("parse batch.restoreStyles' result for the toast", () => {
    const timelineId = newId<'Timeline'>();
    const result = { applied: [newId<'Timeline'>()], skipped: [{ timelineId, reason: 'changedSince' }] };
    expect(batchStyleResultSchema.parse(result)).toEqual(result);
    expect(
      batchStyleResultSchema.safeParse({ ...result, skipped: [{ timelineId, reason: 'gone' }] }).success,
    ).toBe(false);
  });
});

describe('commit announcer', () => {
  const setup = (maxPending?: number) => {
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: createManualClock(0) });
    const events = createEventBus({ clock: createManualClock(5) });
    const sent: TaalcutEvent[] = [];
    events.on('library.changed', (event) => sent.push(event));
    const announcer = createCommitAnnouncer(maxPending === undefined ? {} : { maxPending });
    const detach = announcer.attach(bus, events);
    return { bus, sent, announcer, detach };
  };

  it('sends what a handler noted only once its command commits, and drops what a failure noted', async () => {
    const { bus, sent, announcer, detach } = setup();
    const projectId = newId<'Project'>();
    const timelineId = newId<'Timeline'>();
    /** How many events were out while each successful run of the handler was still going. */
    const during: number[] = [];
    const save = defineCommand({
      name: 'timeline.save',
      payload: z.object({ projectId: z.string(), fail: z.boolean() }),
      sideEffect: 'write',
      handle: ({ fail }, context) => {
        announcer.note(context, {
          projectId: projectId,
          entity: 'timeline',
          change: 'updated',
          ids: [timelineId],
        });
        if (fail) {
          announcer.drop(context);
          return err(ConflictError({ entity: 'timeline', id: timelineId }));
        }
        during.push(sent.length);
        return ok({ result: null, inverse: { name: 'timeline.save', payload: { projectId, fail: false } } });
      },
    });
    bus.register(save);
    expect((await bus.dispatch(save, { projectId, fail: true }, UI)).ok).toBe(false);
    expect(sent).toEqual([]);
    unwrap(await bus.dispatch(save, { projectId, fail: false }, UI));
    unwrap(await bus.undo(projectId as ProjectId, UI));
    expect(sent.map((event) => event.payload)).toEqual([
      { projectId, entity: 'timeline', change: 'updated', ids: [timelineId] },
      { projectId, entity: 'timeline', change: 'updated', ids: [timelineId] },
    ]);
    expect(during).toEqual([0, 1]);
    detach();
    unwrap(await bus.redo(projectId as ProjectId, UI));
    expect(sent).toHaveLength(2);
  });

  it('keeps at most maxPending uncommitted commands, dropping the oldest', () => {
    const events = createEventBus({ clock: createManualClock(5) });
    const sent: TaalcutEvent[] = [];
    events.on('library.changed', (event) => sent.push(event));
    let commit: CommandListener = () => undefined;
    const announcer = createCommitAnnouncer({ maxPending: 2 });
    announcer.attach({ subscribe: (listener) => ((commit = listener), () => undefined) }, events);
    const ids = [newId<'Command'>(), newId<'Command'>(), newId<'Command'>()];
    for (const commandId of ids)
      announcer.note(
        { commandId },
        { projectId: null, entity: 'project', change: 'created', ids: [commandId] },
      );
    // The third note pushed the first out. Noting the first again starts it afresh at the back, which pushes
    // the second out.
    announcer.note(
      { commandId: ids[0]! },
      { projectId: null, entity: 'project', change: 'updated', ids: ['x'] },
    );
    for (const id of ids)
      commit({ kind: 'executed', id, name: 'project.create', projectId: null, origin: UI });
    expect(sent.map((event) => event.payload)).toEqual([
      { projectId: null, entity: 'project', change: 'updated', ids: ['x'] },
      { projectId: null, entity: 'project', change: 'created', ids: [ids[2]] },
    ]);
    expect(() => createCommitAnnouncer({ maxPending: 0 })).toThrow(RangeError);
  });
});
