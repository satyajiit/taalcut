// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A template published from the app, merged into the hub repo (the index
 * builder standing in for Pages), then forked by another install. One
 * maintainer `hidden` label drops it from the next index.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createMemorySettingsStore,
  HUB_COMMANDS,
  hubIndexSchema,
  hubTemplateV0Schema,
  newId,
  ok,
  type HubTemplateV0,
} from '@taalcut/core';
import { createHubCommands } from '../../src/hub/hub-commands';
import { createHubIndexClient } from '../../src/hub/index-cache';
import { createHubService } from '../../src/hub/hub-service';
import {
  createMemoryHubIndexCache,
  createMemoryHubSubmissionStore,
} from '../../src/testing/memory-hub-stores';
import { createSettingsMyRatings } from '../../src/hub/my-ratings';
import { sha256Hex } from '../../src/store/change-key';
import { AGENT, setupTemplates, UI } from '../helpers/setup';
import { fakeTransport, hubIds, sharedDocument } from './helpers';

const scripts = join(import.meta.dirname, '..', '..', '..', '..', 'hub', 'scripts');
const ENDPOINTS = { indexUrl: 'https://hub.example/v0/index.json', workerUrl: 'https://worker.example' };

function run(name: string, args: string[]): { status: number; stderr: string } {
  const result = spawnSync(process.execPath, [join(scripts, name), ...args], { encoding: 'utf8' });
  return { status: result.status ?? 1, stderr: result.stderr ?? '' };
}

describe('publish, merge, fork', () => {
  it('lands in the index, forks on another install, and hides on one label', async () => {
    const publisher = setupTemplates();
    const shared = sharedDocument();
    await publisher.store.create(shared.template, { name: 'Day one', projectId: null, listed: true });
    const submitted: HubTemplateV0[] = [];
    const transport = fakeTransport();
    transport.submit = async (body) => {
      // What the Worker does first: the document must parse as a hub template.
      const parsed = hubTemplateV0Schema.parse(body.template);
      submitted.push(parsed);
      return ok({
        submissionId: newId<'HubSubmission'>(),
        hubId: parsed.id,
        version: parsed.version,
        state: 'open' as const,
        pullRequest: 4,
      });
    };
    const cache = createMemoryHubIndexCache();
    const submissions = createMemoryHubSubmissionStore();
    const myRatings = createSettingsMyRatings(createMemorySettingsStore());
    const service = createHubService({
      endpoints: ENDPOINTS,
      localOnly: () => false,
      transport,
      index: createHubIndexClient({ cache, transport, clock: publisher.clock }),
      templates: publisher.service,
      submissions,
      clock: publisher.clock,
      ids: hubIds(),
      newHubTemplateId: () => newId<'HubTemplate'>(),
      myRatings,
    });
    publisher.bus.register(
      ...createHubCommands({
        service,
        transport,
        index: createHubIndexClient({ cache, transport, clock: publisher.clock }),
        store: publisher.store,
        submissions,
        acknowledgements: {
          async record(input) {
            return ok({
              featureId: input.featureId,
              termsVersion: input.termsVersion,
              acknowledgedAt: input.at ?? 0,
              context: input.context ?? null,
            });
          },
        },
        settings: createMemorySettingsStore(),
        myRatings,
        clock: publisher.clock,
        ids: { slot: () => newId(), overlay: () => newId() },
        openShare: () => undefined,
        libraryMetadata: true,
      }).all,
    );
    const published = await publisher.bus.dispatch(
      HUB_COMMANDS.publish,
      {
        projectId: null,
        templateId: shared.template.id,
        version: 1,
        form: {
          name: 'Day one',
          description: 'Four cuts on the beat.',
          handle: 'goa.creator',
          tags: ['travel'],
          language: 'en',
          includeStyle: false,
        },
        acknowledgedAt: publisher.clock.now(),
      },
      UI,
    );
    expect(published.ok).toBe(true);
    const document = submitted[0];
    if (!document) throw new Error('publish sent no document');

    const root = mkdtempSync(join(tmpdir(), 'taalcut-publish-'));
    try {
      const rel = `templates/${document.id.slice(0, 2)}/${document.id}.json`;
      mkdirSync(join(root, 'templates', document.id.slice(0, 2)), { recursive: true });
      mkdirSync(join(root, 'moderation'), { recursive: true });
      writeFileSync(join(root, rel), JSON.stringify(document));
      writeFileSync(join(root, 'moderation', 'hidden.json'), '[]\n');
      const validated = run('validate.mjs', ['--root', root, '--files', rel]);
      expect(validated.status, validated.stderr).toBe(0);
      const now = String(publisher.clock.now());
      const built = run('build-index.mjs', ['--root', root, '--now', now]);
      expect(built.status, built.stderr).toBe(0);

      const indexPath = join(root, 'site', 'v0', 'index.json');
      const filePath = join(root, 'site', 'v0', 'templates', `${document.id}.json`);
      const reader = install(indexPath, filePath);
      const page = await reader.service.browse({ sort: 'newest', limit: 50 });
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      const item = page.value.items[0];
      expect(item?.id).toBe(document.id);
      expect(item?.rating).toEqual({ count: 4, mean: 4.5 });
      if (!item) return;

      const templateId = newId<'Template'>();
      const forked = await reader.bus.dispatch(
        HUB_COMMANDS.fork,
        { projectId: null, hubId: item.id, version: item.version, sha256: item.sha256, templateId },
        AGENT,
      );
      expect(forked.ok && forked.value.result).toEqual({ templateId, version: 1 });
      const stored = await reader.store.get(templateId);
      expect(stored.ok && stored.value.summary.provenance).toMatchObject({
        kind: 'hub',
        hubId: document.id,
        licence: 'CC0-1.0',
        handle: 'goa.creator',
      });

      const event = join(root, 'labeled.json');
      writeFileSync(
        event,
        JSON.stringify({
          action: 'labeled',
          label: { name: 'hidden' },
          issue: {
            number: 9,
            updated_at: '2026-10-14T12:00:00.000Z',
            labels: [{ name: 'report' }, { name: `hub:${document.id}` }, { name: 'hidden' }],
          },
        }),
      );
      const hidden = run('moderate.mjs', ['--root', root, '--github-event', event, '--event-name', 'issues']);
      expect(hidden.status, hidden.stderr).toBe(0);
      const rebuilt = run('build-index.mjs', ['--root', root, '--now', now]);
      expect(rebuilt.status, rebuilt.stderr).toBe(0);
      const after = await install(indexPath, filePath).service.browse({ sort: 'newest', limit: 50 });
      expect(after.ok && after.value.items).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function install(indexPath: string, filePath: string) {
  const setup = setupTemplates();
  const transport = fakeTransport();
  transport.index = async () =>
    ok({ status: 200, body: hubIndexSchema.parse(JSON.parse(readFileSync(indexPath, 'utf8'))), etag: null });
  transport.template = async () => {
    const text = readFileSync(filePath, 'utf8');
    return ok({ body: hubTemplateV0Schema.parse(JSON.parse(text)), sha256: sha256Hex(text) });
  };
  transport.ratings = async () => {
    const index = hubIndexSchema.parse(JSON.parse(readFileSync(indexPath, 'utf8')));
    const id = index.templates[0]?.id;
    return ok({ generatedAt: 1, ratings: id ? { [id]: { count: 4, mean: 4.5 } } : {} });
  };
  const cache = createMemoryHubIndexCache();
  const service = createHubService({
    endpoints: ENDPOINTS,
    localOnly: () => false,
    transport,
    index: createHubIndexClient({ cache, transport, clock: setup.clock }),
    templates: setup.service,
    submissions: createMemoryHubSubmissionStore(),
    clock: setup.clock,
    ids: hubIds(),
    newHubTemplateId: () => newId<'HubTemplate'>(),
    myRatings: createSettingsMyRatings(createMemorySettingsStore()),
  });
  setup.bus.register(
    ...createHubCommands({
      service,
      transport,
      index: createHubIndexClient({ cache, transport, clock: setup.clock }),
      store: setup.store,
      submissions: createMemoryHubSubmissionStore(),
      acknowledgements: {
        async record(input) {
          return ok({
            featureId: input.featureId,
            termsVersion: input.termsVersion,
            acknowledgedAt: input.at ?? 0,
            context: null,
          });
        },
      },
      settings: createMemorySettingsStore(),
      myRatings: createSettingsMyRatings(createMemorySettingsStore()),
      clock: setup.clock,
      ids: { slot: () => newId(), overlay: () => newId() },
      openShare: () => undefined,
      libraryMetadata: true,
    }).all,
  );
  return { ...setup, service };
}
