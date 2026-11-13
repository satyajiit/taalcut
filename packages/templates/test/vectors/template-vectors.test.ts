// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, parseTemplateVectorId, type Template, type TemplateId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createTemplateVectors, intentVectorId } from '../../src/index';
import { createMemoryVectorIndex } from '../../src/test-support';
import { intent, referenceTemplate } from '../helpers/fixtures';
import { unwrap } from '../helpers/result';
import { DIMS, nth, recordingEmbedder, setupVectors } from './helpers';

type Setup = ReturnType<typeof setupVectors>;

async function stored(setup: Setup, name = 'Goa trip'): Promise<Template> {
  const template = referenceTemplate();
  unwrap(await setup.store.create(template, { name, projectId: null, listed: true }));
  return template;
}

/** The template's next version with slot `index`'s intent rewritten. */
async function editIntent(setup: Setup, template: Template, index: number, text: string): Promise<Template> {
  const slots = template.slots.map((slot, at) => (at === index ? { ...slot, intent: intent(text) } : slot));
  const next = { ...template, slots, version: template.version + 1, parentVersion: template.version };
  const change = {
    command: 'template.slot.editIntent',
    source: 'ui' as const,
    changeKey: `k${next.version}`,
  };
  unwrap(await setup.store.addVersion(next, change));
  return next;
}

const idsOf = (setup: Setup, templateId: TemplateId) =>
  unwrap(setup.index.ids({ sourceId: templateId })).sort();

describe('template vectors: sync', () => {
  it("writes the head's document and slot intents, by template, with casting's purpose for intents", async () => {
    const setup = setupVectors();
    const template = await stored(setup);
    const report = unwrap(await setup.vectors.sync([template.id]));
    expect(report).toEqual({ written: 1, current: 0, removed: 0, embedded: 5 });
    const ids = idsOf(setup, template.id);
    expect(ids).toHaveLength(5);
    expect(ids.map((id) => parseTemplateVectorId(id)?.kind).sort()).toEqual([
      'intent',
      'intent',
      'intent',
      'intent',
      'template',
    ]);
    expect(setup.embedder.calls.map((call) => [call.purpose, call.texts.length])).toEqual([
      ['document', 1],
      ['query', 4],
    ]);
    const slot = nth(template.slots, 0);
    expect(unwrap(setup.vectors.get([intentVectorId(template.id, slot.id, 'shot 1')])).size).toBe(1);
  });

  it('embeds nothing when the set is current', async () => {
    const setup = setupVectors();
    const template = await stored(setup);
    unwrap(await setup.vectors.sync([template.id]));
    setup.embedder.calls.length = 0;
    expect(unwrap(await setup.vectors.sync([template.id]))).toEqual({
      written: 0,
      current: 1,
      removed: 0,
      embedded: 0,
    });
    expect(setup.embedder.calls).toEqual([]);
  });

  it('a new version embeds only its changed texts and replaces the set', async () => {
    const setup = setupVectors();
    const template = await stored(setup);
    unwrap(await setup.vectors.sync([template.id]));
    const before = idsOf(setup, template.id);
    setup.embedder.calls.length = 0;
    await editIntent(setup, template, 2, 'close up of hands pouring coffee');
    unwrap(await setup.vectors.sync([template.id]));
    // The document names every intent, so it changes too; the three other intents keep their vectors.
    expect(setup.embedder.calls.flatMap((call) => call.texts)).toHaveLength(2);
    expect(setup.embedder.calls.find((call) => call.purpose === 'query')?.texts).toEqual([
      'close up of hands pouring coffee',
    ]);
    const after = idsOf(setup, template.id);
    expect(after).toHaveLength(5);
    expect(after.filter((id) => before.includes(id))).toHaveLength(3);
  });

  it('a rename re-embeds the document alone', async () => {
    const setup = setupVectors();
    const template = await stored(setup);
    unwrap(await setup.vectors.sync([template.id]));
    setup.embedder.calls.length = 0;
    unwrap(await setup.store.setMeta(template.id, { name: 'Coffee morning', tags: ['coffee'] }));
    unwrap(await setup.vectors.sync([template.id]));
    expect(setup.embedder.calls).toEqual([
      { purpose: 'document', texts: [expect.stringContaining('Coffee morning')] },
    ]);
  });

  it('a slot dropped in the new version leaves no vector behind', async () => {
    const setup = setupVectors();
    const template = await stored(setup);
    unwrap(await setup.vectors.sync([template.id]));
    const silent = { ...intent('', 'pending'), shotType: null, motion: null };
    const slots = template.slots.map((slot, at) => (at === 3 ? { ...slot, intent: silent } : slot));
    const next = { ...template, slots, version: 2, parentVersion: 1 };
    unwrap(await setup.store.addVersion(next, { command: 'x.y', source: 'ui', changeKey: 'k' }));
    unwrap(await setup.vectors.sync([template.id]));
    expect(idsOf(setup, template.id)).toHaveLength(4);
  });

  it('removes the vectors of a deleted template', async () => {
    const setup = setupVectors();
    const template = await stored(setup);
    unwrap(await setup.vectors.sync([template.id]));
    unwrap(await setup.store.remove(template.id));
    expect(unwrap(await setup.vectors.sync([template.id])).removed).toBe(1);
    expect(setup.index.count()).toBe(0);
  });

  it('embeds across templates in batches of at most 64, one purpose per call', async () => {
    const setup = setupVectors();
    const ids: TemplateId[] = [];
    for (let n = 0; n < 20; n++) {
      const template = referenceTemplate();
      const slots = template.slots.map((slot, at) => ({ ...slot, intent: intent(`shot ${n} ${at}`) }));
      unwrap(
        await setup.store.create({ ...template, slots }, { name: `T${n}`, projectId: null, listed: true }),
      );
      ids.push(template.id);
    }
    expect(unwrap(await setup.vectors.sync(ids)).written).toBe(20);
    expect(setup.embedder.calls.map((call) => [call.purpose, call.texts.length])).toEqual([
      ['document', 20],
      ['query', 64],
      ['query', 16],
    ]);
  });
});

describe('template vectors: reconcile', () => {
  it('backfills every template, unlisted and archived ones too', async () => {
    const setup = setupVectors();
    const listed = await stored(setup, 'Listed');
    const unlisted = referenceTemplate();
    unwrap(await setup.store.create(unlisted, { name: 'Plan', projectId: null, listed: false }));
    unwrap(await setup.store.setMeta(listed.id, { archived: true }));
    const report = unwrap(await setup.vectors.reconcile());
    expect(report.written).toBe(2);
    expect(idsOf(setup, listed.id)).toHaveLength(5);
    expect(idsOf(setup, unlisted.id)).toHaveLength(5);
  });

  it("drops templates the store doesn't have and ids that aren't the template index's", async () => {
    const setup = setupVectors();
    const kept = await stored(setup);
    unwrap(await setup.vectors.reconcile());
    const gone = newId<'Template'>() as TemplateId;
    const vector = new Array<number>(DIMS).fill(1);
    unwrap(
      setup.index.upsert([
        { id: `template:${gone}:${'0'.repeat(16)}`, vector, metadata: { sourceId: gone, kind: 'template' } },
        { id: 'stray', vector, metadata: { sourceId: kept.id, kind: 'template' } },
      ]),
    );
    const report = unwrap(await setup.vectors.reconcile());
    expect(report.removed).toBe(1);
    expect(unwrap(setup.index.ids()).every((id) => parseTemplateVectorId(id)?.templateId === kept.id)).toBe(
      true,
    );
    expect(unwrap(setup.index.ids())).not.toContain('stray');
  });

  it("fills a new space's empty index from the same store (the embedding model changed)", async () => {
    const setup = setupVectors();
    await stored(setup);
    unwrap(await setup.vectors.reconcile());
    const next = createMemoryVectorIndex('next_space_tpl', DIMS);
    const vectors = createTemplateVectors({ index: next, embedder: recordingEmbedder(), store: setup.store });
    expect(unwrap(await vectors.reconcile()).written).toBe(1);
    expect(next.count()).toBe(5);
  });

  it('runs one at a time: a sync asked during a reconcile waits for it', async () => {
    const setup = setupVectors();
    const template = await stored(setup);
    const order: string[] = [];
    const reconcile = setup.vectors.reconcile().then(() => order.push('reconcile'));
    const sync = setup.vectors.sync([template.id]).then((report) => {
      order.push('sync');
      return report;
    });
    await Promise.all([reconcile, sync]);
    expect(order).toEqual(['reconcile', 'sync']);
    expect(unwrap(await setup.vectors.sync([template.id])).current).toBe(1);
  });
});
