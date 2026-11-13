// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HubSubmissionStore (P3-B12): a submission recorded with hub.publish's context commits with its audit row
 * (and not before), a redo records it again in place, states move on, the list is newest first and filters by
 * template, and latestFor gives the hub id and version an update must reuse.
 */
import {
  createCommandBus,
  defineCommand,
  idSchema,
  newId,
  ok,
  systemClock,
  unwrap,
  type HubSubmissionView,
  type TemplateId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createCommandUnitOfWork, createHubSubmissionStore } from '../../src/index';
import { openTestDb } from '../helpers';

function submission(templateId: TemplateId, version: number, createdAt: number): HubSubmissionView {
  return {
    id: newId<'HubSubmission'>(),
    hubId: newId<'HubTemplate'>(),
    version,
    templateId,
    templateVersion: version + 2,
    state: 'open',
    createdAt,
    checkedAt: null,
  };
}

describe('hub submission store', () => {
  it('records with the command, so the row commits with its audit entry', async () => {
    const db = openTestDb({ file: false });
    const commands = createCommandUnitOfWork(db);
    const store = createHubSubmissionStore(db, { commands });
    const templateId = newId<'Template'>();
    const view = submission(templateId, 1, 100);
    const publish = defineCommand({
      name: 'hub.publish',
      payload: z.object({ projectId: z.null(), templateId: idSchema<'Template'>() }),
      sideEffect: 'external',
      handle: commands.handle(async (_payload, context) => {
        unwrap(await store.record(view, context));
        expect(unwrap(await store.list({}))).toEqual([]); // staged, not yet written
        return ok({ result: view });
      }),
    });
    const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
    bus.register(publish);
    unwrap(await bus.dispatch(publish, { projectId: null, templateId }, { source: 'ui', actor: 'user' }));
    expect(unwrap(await store.list({}))).toEqual([view]);
    // A redo records the same submission again: replaced, not doubled.
    unwrap(await store.record({ ...view, state: 'merged', checkedAt: 120 }));
    expect(unwrap(await store.list({}))).toEqual([{ ...view, state: 'merged', checkedAt: 120 }]);
  });

  it('moves states, lists newest first by template, and finds the latest share of a lineage', async () => {
    const db = openTestDb({ file: false });
    const store = createHubSubmissionStore(db);
    const goa = newId<'Template'>();
    const pune = newId<'Template'>();
    const first = submission(goa, 1, 10);
    const second = { ...submission(goa, 2, 30), hubId: first.hubId };
    const other = submission(pune, 1, 20);
    for (const item of [first, second, other]) unwrap(await store.record(item));

    expect(unwrap(await store.list({})).map((s) => s.id)).toEqual([second.id, other.id, first.id]);
    expect(unwrap(await store.list({ templateId: goa })).map((s) => s.id)).toEqual([second.id, first.id]);
    expect(unwrap(await store.latestFor(goa))).toEqual({ hubId: first.hubId, version: 2 });
    expect(unwrap(await store.latestFor(newId<'Template'>()))).toBeNull();

    unwrap(await store.setState(first.id, 'hidden', 99));
    expect(unwrap(await store.list({ templateId: goa }))[1]).toEqual({
      ...first,
      state: 'hidden',
      checkedAt: 99,
    });
    const unknown = await store.setState(newId<'HubSubmission'>(), 'closed', 1);
    expect(!unknown.ok && unknown.error.code).toBe('core.not_found');
  });

  it('refuses what core would not parse, on the way in and out', async () => {
    const db = openTestDb({ file: false });
    const store = createHubSubmissionStore(db);
    const bad = await store.record({ ...submission(newId<'Template'>(), 1, 1), version: 0 });
    expect(!bad.ok && bad.error.code).toBe('core.validation');
    const late = await store.setState(newId<'HubSubmission'>(), 'open', -5);
    expect(!late.ok && late.error.code).toBe('core.validation');
    db.driver
      .prepare(
        `INSERT INTO hub_submissions (id, hub_id, version, template_id, template_version, state, created_at)
         VALUES ('not-an-id', 'h', 1, 't', 1, 'open', 1)`,
      )
      .run();
    const listed = await store.list({});
    expect(!listed.ok && listed.error.code).toBe('core.validation');
  });
});
