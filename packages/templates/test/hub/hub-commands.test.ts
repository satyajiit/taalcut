// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Publish is person-only. A fork is undone by template.discard. A bad hash is hub.integrity. */
import { describe, expect, it } from 'vitest';
import {
  createMemorySettingsStore,
  HUB_COMMANDS,
  HUB_HANDLE_SETTING,
  HUB_LICENCE_TERMS,
  HubIntegrity,
  newId,
  ok,
  ValidationError,
  type CommandOrigin,
  type HubSubmissionId,
  type TemplateMeta,
  type TemplateMetaPatch,
  type TemplateStore,
} from '@taalcut/core';
import { createHubCommands } from '../../src/hub/hub-commands';
import { createHubIndexClient } from '../../src/hub/index-cache';
import { createHubService } from '../../src/hub/hub-service';
import {
  createMemoryHubIndexCache,
  createMemoryHubSubmissionStore,
} from '../../src/testing/memory-hub-stores';
import { createSettingsMyRatings } from '../../src/hub/my-ratings';
import { AGENT, setupTemplates, UI } from '../helpers/setup';
import { fakeTransport, hubIds, indexEntry, indexOf, sharedDocument } from './helpers';

const MCP: CommandOrigin = { source: 'mcp', actor: 'mcp:client' };
const ENDPOINTS = { indexUrl: 'https://hub.example/v0/index.json', workerUrl: 'https://worker.example' };

function watch(store: TemplateStore) {
  const created: TemplateMeta[] = [];
  const metas: TemplateMetaPatch[] = [];
  const wrapped: TemplateStore = new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'create') {
        return (
          template: Parameters<TemplateStore['create']>[0],
          meta: TemplateMeta,
          context?: Parameters<TemplateStore['create']>[2],
        ) => {
          created.push(meta);
          return target.create(template, meta, context);
        };
      }
      if (prop === 'setMeta') {
        return (
          templateId: Parameters<TemplateStore['setMeta']>[0],
          patch: TemplateMetaPatch,
          context?: Parameters<TemplateStore['setMeta']>[2],
        ) => {
          metas.push(patch);
          return target.setMeta(templateId, patch, context);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { store: wrapped, created, metas };
}

function rig(options: { readonly libraryMetadata?: boolean } = {}) {
  const setup = setupTemplates();
  const watched = watch(setup.store);
  const transport = fakeTransport();
  const cache = createMemoryHubIndexCache();
  const index = createHubIndexClient({ cache, transport, clock: setup.clock });
  const submissions = createMemoryHubSubmissionStore();
  const settings = createMemorySettingsStore();
  const myRatings = createSettingsMyRatings(settings);
  const acks: { featureId: string; termsVersion: string; at?: number }[] = [];
  let ackError: ReturnType<typeof ValidationError> | null = null;
  const opened: { templateId: string; version: number | undefined }[] = [];
  const service = createHubService({
    endpoints: ENDPOINTS,
    localOnly: () => false,
    transport,
    index,
    templates: setup.service,
    submissions,
    clock: setup.clock,
    ids: hubIds(),
    newHubTemplateId: () => newId<'HubTemplate'>(),
    myRatings,
  });
  const commands = createHubCommands({
    service,
    transport,
    index,
    store: watched.store,
    submissions,
    acknowledgements: {
      async record(input) {
        if (ackError) return { ok: false, error: ackError };
        acks.push(input);
        return ok({
          featureId: input.featureId,
          termsVersion: input.termsVersion,
          acknowledgedAt: input.at ?? 0,
          context: input.context ?? null,
        });
      },
    },
    settings,
    myRatings,
    clock: setup.clock,
    ids: { slot: () => newId(), overlay: () => newId() },
    openShare: (templateId, version) => opened.push({ templateId, version }),
    libraryMetadata: options.libraryMetadata ?? true,
  });
  setup.bus.register(...commands.all);
  return {
    ...setup,
    hub: service,
    transport,
    submissions,
    settings,
    acks,
    opened,
    watched,
    commands,
    setAckError: (error: ReturnType<typeof ValidationError> | null) => (ackError = error),
  };
}

const publishPayload = (templateId: string) => ({
  projectId: null,
  templateId,
  version: 1,
  form: {
    name: 'Day one',
    description: 'Four cuts on the beat.',
    handle: 'goa.creator',
    tags: ['travel'],
    language: 'en' as const,
    includeStyle: false,
  },
  acknowledgedAt: 1_760_000_000_000,
});

describe('hub commands', () => {
  it('refuses publish from the agent and from MCP', async () => {
    const { bus, store } = rig();
    const template = sharedDocument().template;
    await store.create(template, { name: 'Day one', projectId: null, listed: true });
    const payload = publishPayload(template.id);
    const agent = await bus.dispatch(HUB_COMMANDS.publish, payload, AGENT);
    const mcp = await bus.dispatch(HUB_COMMANDS.publish, payload, MCP);
    expect(!agent.ok && agent.error.code).toBe('core.command_source_refused');
    expect(!mcp.ok && mcp.error.code).toBe('core.command_source_refused');
  });

  it('refuses publish without an acknowledgement time, a handle, or a recorded acknowledgement', async () => {
    const box = rig();
    const template = sharedDocument().template;
    await box.store.create(template, { name: 'Day one', projectId: null, listed: true });
    const base = publishPayload(template.id);
    const noTime = await box.bus.dispatch(HUB_COMMANDS.publish, { ...base, acknowledgedAt: undefined }, UI);
    expect(!noTime.ok && noTime.error.code).toBe('core.validation');
    expect(!noTime.ok && noTime.error.params).toMatchObject({ field: 'acknowledgedAt' });
    const form = { ...base.form };
    delete (form as { handle?: string }).handle;
    const noHandle = await box.bus.dispatch(HUB_COMMANDS.publish, { ...base, form }, UI);
    expect(!noHandle.ok && noHandle.error.code).toBe('core.validation');
    expect(!noHandle.ok && noHandle.error.params).toMatchObject({ field: 'form.handle' });

    box.setAckError(ValidationError({ field: 'acknowledgements' }));
    const failed = await box.bus.dispatch(HUB_COMMANDS.publish, base, UI);
    expect(!failed.ok && failed.error.code).toBe('core.validation');
    expect(box.transport.calls.filter((call) => call === 'submit')).toEqual([]);
    expect(box.acks).toEqual([]);
  });

  it('publishes once the licence is recorded and remembers the handle', async () => {
    const box = rig();
    const template = sharedDocument().template;
    await box.store.create(template, { name: 'Day one', projectId: null, listed: true });
    const submissionId = newId<'HubSubmission'>();
    box.transport.submit = async () => {
      box.transport.calls.push('submit');
      return ok({ submissionId, hubId: newId<'HubTemplate'>(), version: 1, state: 'open', pullRequest: 7 });
    };
    const done = await box.bus.dispatch(HUB_COMMANDS.publish, publishPayload(template.id), UI);
    expect(done.ok && done.value.undoable).toBe(false);
    expect(box.acks).toEqual([
      expect.objectContaining({
        featureId: HUB_LICENCE_TERMS.featureId,
        termsVersion: HUB_LICENCE_TERMS.termsVersion,
        at: 1_760_000_000_000,
      }),
    ]);
    const handle = await box.settings.get(HUB_HANDLE_SETTING);
    expect(handle.ok && handle.value).toBe('goa.creator');
    const listed = await box.submissions.list({});
    expect(listed.ok && listed.value.map((row) => row.id)).toEqual([submissionId as HubSubmissionId]);
    const undone = await box.bus.undo(null, UI);
    expect(undone.ok && undone.value).toBeNull();
  });

  it('forks with provenance and undoes through template.discard', async () => {
    const box = rig();
    const shared = sharedDocument();
    const entry = indexEntry({
      id: shared.doc.id,
      version: shared.doc.version,
      sha256: shared.sha256,
      name: shared.doc.name,
      handle: shared.doc.handle,
    });
    box.transport.index = async () => ok({ status: 200, body: indexOf([entry]), etag: 'W/"f"' });
    box.transport.template = async () =>
      ok({ body: JSON.parse(shared.text) as unknown, sha256: shared.sha256 });
    const templateId = newId<'Template'>();
    const done = await box.bus.dispatch(
      HUB_COMMANDS.fork,
      {
        projectId: null,
        hubId: shared.doc.id,
        version: shared.doc.version,
        sha256: shared.sha256,
        templateId,
      },
      AGENT,
    );
    expect(done.ok && done.value.result).toEqual({ templateId, version: 1 });
    expect(done.ok && done.value.undoable).toBe(true);
    expect(box.watched.created[0]).toMatchObject({
      name: shared.doc.name,
      projectId: null,
      listed: true,
      provenance: {
        kind: 'hub',
        hubId: shared.doc.id,
        version: shared.doc.version,
        handle: shared.doc.handle,
        licence: 'CC0-1.0',
        forkedAt: box.clock.now(),
        removed: false,
      },
    });
    // One write: the provenance goes with the lineage, not in a second setMeta.
    expect(box.watched.metas).toEqual([]);
    const stored = await box.service.get({ templateId });
    expect(stored.ok && stored.value.summary.provenance).toMatchObject({ kind: 'hub', hubId: shared.doc.id });
    expect(stored.ok && stored.value.template.origin).toEqual({ kind: 'manual' });
    const undone = await box.bus.undo(null, UI);
    expect(undone.ok).toBe(true);
    const gone = await box.service.get({ templateId });
    expect(!gone.ok && gone.error.code).toBe('core.not_found');
  });

  it('refuses a fork when the store would drop its provenance, and fetches nothing', async () => {
    const box = rig({ libraryMetadata: false });
    const shared = sharedDocument();
    const payload = {
      projectId: null,
      hubId: shared.doc.id,
      version: 1,
      sha256: shared.sha256,
      templateId: newId<'Template'>(),
    };
    const refused = await box.bus.dispatch(HUB_COMMANDS.fork, payload, UI);
    expect(!refused.ok && refused.error.code).toBe('core.not_implemented');
    expect(!refused.ok && refused.error.params).toMatchObject({ feature: 'templates.library' });
    expect(box.transport.calls).toEqual([]);
    expect(box.watched.created).toEqual([]);
  });

  it('retries a hash once against a fresh index, then reports hub.integrity', async () => {
    const box = rig();
    const shared = sharedDocument();
    const stale = 'b'.repeat(64);
    let files = 0;
    box.transport.index = async () =>
      ok({
        status: 200,
        body: indexOf([indexEntry({ id: shared.doc.id, version: 1, sha256: shared.sha256 })]),
        etag: 'W/"i"',
      });
    box.transport.template = async () => {
      files += 1;
      const sha = files === 1 ? 'c'.repeat(64) : shared.sha256;
      return ok({ body: JSON.parse(shared.text) as unknown, sha256: sha });
    };
    const recovered = await box.bus.dispatch(
      HUB_COMMANDS.fork,
      { projectId: null, hubId: shared.doc.id, version: 1, sha256: stale, templateId: newId<'Template'>() },
      UI,
    );
    expect(recovered.ok).toBe(true);
    expect(files).toBe(2);

    files = 0;
    box.transport.template = async () => {
      files += 1;
      return ok({ body: JSON.parse(shared.text) as unknown, sha256: 'd'.repeat(64) });
    };
    box.transport.index = async () =>
      ok({
        status: 200,
        body: indexOf([indexEntry({ id: shared.doc.id, version: 1, sha256: stale })]),
        etag: 'W/"j"',
      });
    const broken = await box.bus.dispatch(
      HUB_COMMANDS.fork,
      { projectId: null, hubId: shared.doc.id, version: 1, sha256: stale, templateId: newId<'Template'>() },
      UI,
    );
    expect(!broken.ok && HubIntegrity.is(broken.error)).toBe(true);
    expect(files).toBe(2);
  });

  it("rates and withdraws for the person only, and remembers this install's stars", async () => {
    const box = rig();
    const hubId = newId<'HubTemplate'>();
    const byAgent = await box.bus.dispatch(HUB_COMMANDS.rate, { projectId: null, hubId, stars: 4 }, AGENT);
    expect(!byAgent.ok && byAgent.error.code).toBe('core.command_source_refused');
    const rated = await box.bus.dispatch(HUB_COMMANDS.rate, { projectId: null, hubId, stars: 4 }, UI);
    expect(rated.ok && rated.value.result).toEqual({ stars: 4, count: 1, mean: 5 });
    // A new process reads the same setting: the stars outlive this one.
    const later = createSettingsMyRatings(box.settings);
    expect(await later.get(hubId)).toEqual(ok(4));
    const withdrawn = await box.bus.dispatch(HUB_COMMANDS.rate, { projectId: null, hubId, stars: null }, UI);
    expect(withdrawn.ok && withdrawn.value.result).toEqual({ stars: null, count: 0, mean: 0 });
    expect(await later.get(hubId)).toEqual(ok(null));
    expect(box.transport.calls.filter((call) => call === 'rate' || call === 'withdrawRating')).toEqual([
      'rate',
      'withdrawRating',
    ]);
  });

  it('reports for the person only and returns the moderation issue', async () => {
    const box = rig();
    const payload = { projectId: null, hubId: newId<'HubTemplate'>(), reason: 'spam' as const, note: 'Ads' };
    const byAgent = await box.bus.dispatch(HUB_COMMANDS.report, payload, AGENT);
    expect(!byAgent.ok && byAgent.error.code).toBe('core.command_source_refused');
    const reported = await box.bus.dispatch(HUB_COMMANDS.report, payload, UI);
    expect(reported.ok && reported.value.result).toEqual({ issue: 1 });
  });

  it('refuses to publish a template whose share check finds a link, and sends nothing', async () => {
    const box = rig();
    const template = sharedDocument().template;
    const slots = template.slots.map((slot, index) =>
      index === 0 ? { ...slot, intent: { ...slot.intent, text: 'from www.example.com' } } : slot,
    );
    await box.store.create({ ...template, slots }, { name: 'Day one', projectId: null, listed: true });
    const refused = await box.bus.dispatch(HUB_COMMANDS.publish, publishPayload(template.id), UI);
    expect(!refused.ok && refused.error.code).toBe('hub.invalid');
    expect(box.transport.calls).not.toContain('submit');
    expect(box.acks).toEqual([]);
  });

  it('says a look cannot be shared until the Style store is registered', async () => {
    const box = rig();
    const template = { ...sharedDocument().template, styleId: newId<'Style'>() };
    await box.store.create(template, { name: 'Day one', projectId: null, listed: true });
    const form = { ...publishPayload(template.id).form, includeStyle: true };
    const checked = await box.hub.shareCheck({ templateId: template.id, version: 1, form });
    expect(!checked.ok && checked.error.code).toBe('core.not_implemented');
  });

  it('opens share by calling the port', async () => {
    const box = rig();
    const templateId = newId<'Template'>();
    const done = await box.bus.dispatch(
      HUB_COMMANDS.openShare,
      { projectId: null, templateId, version: 3 },
      AGENT,
    );
    expect(done.ok && done.value.result).toEqual({ opened: true });
    expect(box.opened).toEqual([{ templateId, version: 3 }]);
  });
});
