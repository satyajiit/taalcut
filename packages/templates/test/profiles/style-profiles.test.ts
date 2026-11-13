// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The style profile service: a read builds a stale profile once and keeps a fresh one, the summary follows in the
 * background (or says why it can't), a gone set loses its profile, and a project reads the style it follows.
 */
import {
  createEventBus,
  createManualClock,
  newId,
  ok,
  styleSourceKey,
  type BackgroundModels,
  type StyleSource,
  type TaalcutEvent,
  type Template,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createStyleProfiles } from '../../src/profiles/style-profiles';
import { withStyleProfileReads } from '../../src/profiles/style-profile-reads';
import { createTemplateService } from '../../src/store/template-service';
import { createMemoryTemplateStore } from '../../src/testing/memory-template-store';
import { GOLDEN_PROFILE, goldenTemplates } from './golden-set';
import { goldenIndex, memoryStyleStore } from './helpers';

const SAVED: StyleSource = { kind: 'instagram-collection', collectionId: 'col_travel' };
const refs = (templates: readonly Template[]) => templates.map(({ id, version }) => ({ id, version }));

const answering = (text: string): BackgroundModels & { calls: number } => {
  const models = {
    calls: 0,
    async complete() {
      models.calls++;
      return ok({
        status: 'answered' as const,
        text,
        provider: 'local',
        model: 'qwen',
        local: true,
        costUsd: 0,
        uploadedTo: [],
      });
    },
  };
  return models;
};

async function setup(options: { models?: BackgroundModels; indexOpen?: boolean } = {}) {
  const clock = createManualClock(1_000);
  const templates = createMemoryTemplateStore(clock);
  const golden = goldenTemplates();
  for (const template of golden)
    await templates.create(template, { name: `T ${template.id.slice(-1)}`, projectId: null, listed: true });
  const store = memoryStyleStore();
  store.setMembers(SAVED, refs(golden));
  const events = createEventBus({ clock });
  const seen: TaalcutEvent[] = [];
  events.on('library.changed', (event) => seen.push(event));
  const index = goldenIndex(golden);
  const profiles = createStyleProfiles({
    store,
    templates,
    index: async () => (options.indexOpen === false ? undefined : index),
    ...(options.models ? { models: options.models } : {}),
    events,
    clock,
  });
  const changes = () => seen.flatMap((event) => (event.type === 'library.changed' ? [event.payload] : []));
  return { profiles, store, templates, golden, clock, index, changes };
}

describe('style profiles', () => {
  it('builds a set once, keeps it while nothing changed, and announces it', async () => {
    const { profiles, store, changes } = await setup({ models: answering('Fast, close hooks.') });
    const view = await profiles.view(SAVED);
    expect(view.ok && view.value.profile).toEqual(GOLDEN_PROFILE);
    expect(view.ok && view.value.name).toBe('Set instagram-collection:col_travel');
    expect(view.ok && view.value.exemplars.map((e) => e.name)).toEqual(['T 2']);
    expect(view.ok && view.value.summary.state).toBe('writing');
    await profiles.settled();
    expect(store.puts).toHaveLength(1);
    const again = await profiles.view(SAVED);
    expect(store.puts).toHaveLength(1);
    expect(again.ok && again.value.summary).toMatchObject({
      state: 'written',
      text: 'Fast, close hooks.',
      local: true,
    });
    expect(changes().every((change) => change.entity === 'styleProfile')).toBe(true);
    expect(changes()[0]?.ids).toEqual([styleSourceKey(SAVED)]);
  });

  it('rebuilds when a member is added, and reports fresh otherwise', async () => {
    const { profiles, store, golden } = await setup();
    store.setMembers(SAVED, refs(golden.slice(0, 2)));
    expect(await profiles.refresh(SAVED)).toEqual(ok('built'));
    expect(await profiles.refresh(SAVED)).toEqual(ok('fresh'));
    store.setMembers(SAVED, refs(golden));
    expect(await profiles.refresh(SAVED)).toEqual(ok('built'));
    expect(store.puts.map((put) => put.profile?.members)).toEqual([2, 3]);
  });

  it('keeps a written summary when a rebuild gives the same profile', async () => {
    const { profiles, store, golden, templates } = await setup({ models: answering('Same style.') });
    await profiles.view(SAVED);
    await profiles.settled();
    // A second version with the same structure: a new digest, the same profile.
    const first = golden[0] as Template;
    await templates.addVersion(
      { ...first, version: 2, parentVersion: 1 },
      { command: 'template.rename', source: 'ui', changeKey: 'k'.repeat(64) },
    );
    store.setMembers(SAVED, refs([{ ...first, version: 2 }, ...golden.slice(1)]));
    expect(await profiles.refresh(SAVED)).toEqual(ok('built'));
    expect(store.puts.at(-1)?.summary).toMatchObject({ state: 'written', text: 'Same style.' });
  });

  it('builds without exemplars while the index is closed, and says no model wrote a summary', async () => {
    const { profiles } = await setup({ indexOpen: false });
    const view = await profiles.view(SAVED);
    expect(view.ok && view.value.profile?.exemplars).toEqual([]);
    await profiles.settled();
    const after = await profiles.view(SAVED);
    expect(after.ok && after.value.summary).toEqual({ state: 'none', reason: 'no_model', at: 1_000 });
  });

  it('profiles an empty set as empty, without asking a model', async () => {
    const models = answering('never');
    const { profiles, store } = await setup({ models });
    const empty: StyleSource = { kind: 'tag', tag: 'nothing' };
    store.setMembers(empty, []);
    const view = await profiles.view(empty);
    expect(view.ok && view.value).toMatchObject({ profile: null, exemplars: [], builtAt: null });
    expect(view.ok && view.value.summary).toEqual({ state: 'none', reason: 'empty', at: 1_000 });
    await profiles.settled();
    expect(models.calls).toBe(0);
  });

  it('removes the profile of a set that is gone', async () => {
    const { profiles, store, changes } = await setup();
    await profiles.view(SAVED);
    store.setMembers(SAVED, null);
    expect(await profiles.refresh(SAVED)).toEqual(ok('removed'));
    expect(await store.get(SAVED)).toEqual(ok(null));
    expect(changes().at(-1)).toMatchObject({ entity: 'styleProfile', change: 'deleted' });
    const view = await profiles.view(SAVED);
    expect(!view.ok && view.error.code).toBe('core.not_found');
  });

  it('writes the summary again on request', async () => {
    const models = answering('Again.');
    const { profiles } = await setup({ models });
    await profiles.view(SAVED);
    await profiles.settled();
    const view = await profiles.writeSummary(SAVED);
    expect(view.ok && view.value.summary.state).toBe('writing');
    await profiles.settled();
    expect(models.calls).toBe(2);
  });

  it("reads a project's style, or none", async () => {
    const { profiles, store } = await setup();
    const projectId = newId<'Project'>();
    expect(await profiles.projectView(projectId)).toEqual(ok(null));
    await store.setProjectStyle(projectId, SAVED);
    const view = await profiles.projectView(projectId);
    expect(view.ok && view.value?.profile?.members).toBe(3);
    store.setMembers(SAVED, null);
    expect(await profiles.projectView(projectId)).toEqual(ok(null));
  });

  it('refreshes every stored profile and counts the rebuilt ones', async () => {
    const { profiles, store, golden } = await setup();
    await profiles.view(SAVED);
    expect(await profiles.refreshAll()).toEqual(ok(0));
    store.setMembers(SAVED, refs(golden.slice(1)));
    expect(await profiles.refreshAll()).toEqual(ok(1));
  });
});

describe('the style profile reads', () => {
  it('serve appContract.templates.styleProfile and writeStyleSummary from the profiles', async () => {
    const { profiles } = await setup({ models: answering('Read.') });
    const service = withStyleProfileReads(
      createTemplateService({
        store: createMemoryTemplateStore(createManualClock(1)),
        clock: createManualClock(1),
      }),
      profiles,
    );
    const view = await service.styleProfile({ source: SAVED });
    expect(view.ok && view.value.profile?.members).toBe(3);
    const again = await service.writeStyleSummary({ source: SAVED });
    expect(again.ok && again.value.summary.state).toBe('writing');
    await profiles.settled();
  });
});
