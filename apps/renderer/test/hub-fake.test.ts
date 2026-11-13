// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  callRpc,
  hubTemplateV0Schema,
  newId,
  type HubShareForm,
  type HubTemplateId,
  type UiAction,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import type { FakeHubOptions } from '../src/backend/fake/phase3/hub/hub-state';
import { hubIdOf } from '../src/backend/fake/phase3/hub/hub-seed';
import { fromHubTemplate } from '../src/backend/fake/phase3/hub/hub-convert';
import { FUTURE_FORMAT_SEED, HIDDEN_SEED } from '../src/backend/fake/phase3/hub/hub-seed-data';
import { GOLDEN_HOUR, templateIdOf } from '../src/backend/fake/templates/template-data';

function setup(hub: FakeHubOptions = {}, localOnly = false) {
  const { client, controls } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    ...(localOnly ? { phase2b: { privacy: { localOnly: true } } } : {}),
    make: { renderTickMs: 0 },
    phase3: { hub },
  });
  const dispatch = (name: string, payload: unknown, source: 'ui' | 'agent' = 'ui') =>
    source === 'agent'
      ? controls.bus.dispatch(name, payload, { source, actor: 'agent:test' })
      : callRpc(client.commands.dispatch({ name, payload, source }));
  const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);
  return { client, controls, dispatch, code };
}

const form: HubShareForm = {
  name: 'Golden hour',
  description: 'Twelve cuts on the beat.',
  handle: 'mira.cuts',
  tags: ['sunset'],
  language: 'en',
  includeStyle: false,
};
const golden = templateIdOf(GOLDEN_HOUR);
const first = hubIdOf(1);

describe('the fake hub (P3-B12)', () => {
  it('seeds 40 hub files that parse, each one forkable into a valid template', async () => {
    const { controls } = setup();
    const files = [...controls.phase3.hub.state.files.values()];
    const documents = files.flatMap((file) => (file.kind === 'ok' ? [file.document] : []));
    expect(controls.phase3.hub.state.entries).toHaveLength(40);
    expect(documents).toHaveLength(38);
    for (const document of documents) {
      expect(hubTemplateV0Schema.safeParse(document).error?.issues ?? []).toEqual([]);
      const forked = fromHubTemplate(document, newId<'Template'>(), 0);
      expect(forked.ok ? 'ok' : forked.error.detail).toBe('ok');
    }
  });

  it('browses with filters, sorts and pages as the client does', async () => {
    const { client } = setup();
    const top = await client.hub.browse({ limit: 5 });
    expect(top.items).toHaveLength(5);
    expect(top.nextCursor).toBe('5');
    const means = top.items.map((item) => item.rating?.mean ?? -1);
    expect([...means].sort((a, b) => b - a)).toEqual(means);
    const rest = await client.hub.browse({ limit: 50, cursor: '35' });
    expect(rest.items.at(-1)?.rating).toBeNull();
    const hindi = await client.hub.browse({ language: 'hi' });
    expect(hindi.items.every((item) => item.language === 'hi')).toBe(true);
    const short = await client.hub.browse({ maxSeconds: 15, formatId: 'highlightReel' });
    expect(short.items.length).toBeGreaterThan(0);
    const food = await client.hub.browse({ tags: ['food', 'recipe'], query: 'NANI' });
    expect(food.items.map((item) => item.handle)).toEqual(['nani.kitchen']);
    const fresh = await client.hub.browse({ sort: 'freshest', limit: 2 });
    expect(fresh.items[0]?.trendFreshness).not.toBeNull();
  });

  it('answers status in every state and blocks browse as the client does', async () => {
    expect(await setup().client.hub.status()).toMatchObject({
      configured: true,
      localOnly: false,
      templates: 40,
    });
    const offline = setup({ state: 'offline' });
    const status = await offline.client.hub.status();
    expect(Date.now() - (status.indexFetchedAt ?? 0)).toBeGreaterThan(2.9 * 3_600_000);
    expect((await offline.client.hub.browse({})).items.length).toBeGreaterThan(0);
    const get = await callRpc(offline.client.hub.get({ hubId: first }));
    expect(offline.code(get)).toBe('hub.offline');
    const none = setup({ state: 'notConfigured' });
    expect(await none.client.hub.status()).toMatchObject({
      configured: false,
      indexFetchedAt: null,
      templates: 0,
    });
    expect(none.code(await callRpc(none.client.hub.browse({})))).toBe('hub.not_configured');
    const local = setup({}, true);
    expect((await local.client.hub.status()).localOnly).toBe(true);
    expect(local.code(await callRpc(local.client.hub.browse({})))).toBe('core.local_only');
  });

  it('gets a file, a hidden one and one in a newer format', async () => {
    const { client, code } = setup();
    const detail = await client.hub.get({ hubId: first });
    expect(detail.document.name).toBe('Morning café');
    expect(detail.myRating).toBeNull();
    expect(code(await callRpc(client.hub.get({ hubId: hubIdOf(HIDDEN_SEED) })))).toBe('hub.hidden');
    const newer = await callRpc(client.hub.get({ hubId: hubIdOf(FUTURE_FORMAT_SEED) }));
    expect(newer.ok ? null : [newer.error.code, newer.error.params?.['formatVersion']]).toEqual([
      'hub.unsupported_format',
      1,
    ]);
    expect(code(await callRpc(client.hub.get({ hubId: hubIdOf(77) as HubTemplateId })))).toBe(
      'hub.not_found',
    );
  });

  it('forks with provenance under the caller’s id; undo removes it; a wrong hash is hub.integrity', async () => {
    const { client, dispatch, code } = setup();
    const entry = (await client.hub.get({ hubId: first })).item;
    const templateId = newId<'Template'>();
    const wrong = await dispatch('hub.fork', {
      hubId: first,
      version: entry.version,
      sha256: '0'.repeat(64),
      templateId,
    });
    expect(code(wrong)).toBe('hub.integrity');
    const forked = await dispatch('hub.fork', {
      hubId: first,
      version: entry.version,
      sha256: entry.sha256,
      templateId,
    });
    expect(code(forked)).toBe('ok');
    const made = await client.templates.get({ templateId });
    expect(made.summary.name).toBe('Morning café');
    expect(made.summary.provenance).toMatchObject({
      kind: 'hub',
      hubId: first,
      handle: 'mira.cuts',
      licence: 'CC0-1.0',
    });
    expect(made.template.contactSheet).toBeNull();
    expect((await client.hub.get({ hubId: first })).item.forkedAs).toBe(templateId);
    expect(code(await callRpc(client.commands.undo({ projectId: null, source: 'ui' })))).toBe('ok');
    expect((await client.hub.get({ hubId: first })).item.forkedAs).toBeNull();
  });

  it('checks a share and refuses a publish with problems, from the agent, or over the limit', async () => {
    const { client, dispatch, code } = setup();
    const clean = await client.hub.shareCheck({ templateId: golden, version: 2, form });
    expect(clean.problems).toEqual([]);
    expect(clean.document?.structure.text.every((item) => item.placeholder.startsWith('{'))).toBe(true);
    const linked = { ...form, description: 'More at https://example.com' };
    const problems = await client.hub.shareCheck({ templateId: golden, version: 2, form: linked });
    expect(problems.problems.map((item) => [item.path, item.rule, item.slotIndex])).toContainEqual([
      'description',
      'url',
      null,
    ]);
    const payload = { projectId: null, templateId: golden, version: 2, form, acknowledgedAt: Date.now() };
    expect(code(await dispatch('hub.publish', { ...payload, form: linked }))).toBe('hub.invalid');
    expect(code(await dispatch('hub.publish', { ...payload, acknowledgedAt: undefined }))).toBe(
      'core.validation',
    );
    expect(code(await dispatch('hub.publish', payload, 'agent'))).toBe('core.command_source_refused');
    const sent = await dispatch('hub.publish', payload);
    expect(code(sent)).toBe('ok');
    expect(await client.hub.submissions({ templateId: golden })).toHaveLength(1);
    const limited = setup({ rateLimited: true });
    const refused = await limited.dispatch('hub.publish', payload);
    expect(refused.ok ? null : [refused.error.code, refused.error.params?.['retryAfterSeconds']]).toEqual([
      'hub.rate_limited',
      720,
    ]);
  });

  it('rates, withdraws and reports; refuses them offline; openShare asks the window', async () => {
    const { client, dispatch, code, controls } = setup();
    const before = (await client.hub.get({ hubId: first })).item.rating;
    const rated = await dispatch('hub.rate', { hubId: first, stars: 5 });
    expect(code(rated)).toBe('ok');
    const after = await client.hub.get({ hubId: first });
    expect(after.myRating).toBe(5);
    expect(after.item.rating?.count).toBe((before?.count ?? 0) + 1);
    await dispatch('hub.rate', { hubId: first, stars: null });
    expect((await client.hub.get({ hubId: first })).item.rating).toEqual(before);
    expect(
      code(await dispatch('hub.report', { hubId: first, reason: 'spam', note: 'Same as another' })),
    ).toBe('ok');
    expect(code(await dispatch('hub.rate', { hubId: hubIdOf(HIDDEN_SEED), stars: 4 }))).toBe('hub.hidden');
    const offline = setup({ state: 'offline' });
    expect(offline.code(await offline.dispatch('hub.report', { hubId: first, reason: 'other' }))).toBe(
      'hub.offline',
    );
    const actions: UiAction[] = [];
    controls.events.on('ui.action', (event) => actions.push(event.payload));
    expect(code(await dispatch('hub.openShare', { templateId: golden, version: 2 }))).toBe('ok');
    expect(actions).toEqual([{ action: 'hub.openShare', args: { templateId: golden, version: '2' } }]);
  });
});
