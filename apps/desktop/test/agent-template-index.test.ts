// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template index in the agent process (LRN1-TPL), wired as registerLibraryAgent wires it over a real library
 * database with sqlite-vec: a committed template command reaches the index through the store the root binds, the
 * start's catch-up indexes templates written before it, templates.search finds them by words and meaning, fit reads
 * them, and without an embedding space search answers from words alone.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClockToken,
  CommandBusToken,
  createCommandBus,
  createContainer,
  createEventBus,
  EventBusToken,
  fitTemplatesInputSchema,
  newId,
  parseTemplateVectorId,
  systemClock,
  TEMPLATE_COMMANDS,
  templateIndexName,
  TemplateSearchToken,
  TemplateStoreToken,
  unwrap,
  type EmbeddingSpace,
  type MainServicesClient,
  type Template,
} from '@taalcut/core';
import {
  createLibraryPorts,
  openDatabase,
  openVectorIndex,
  sqliteVecPath,
  type LibraryDatabase,
} from '@taalcut/library';
import { createTemplateCommands, createTemplateService, planFormat } from '@taalcut/templates';
import type { UtilityConfig } from '../src/shared/rpc-ipc';
import { AgentMainServicesToken, LibraryDatabaseToken, LibraryPortsToken } from '../src/shared/tokens';
import { startTemplateIndex, TemplateFitterToken } from '../src/utility/roots/agent-template-index';
import { registerLibraryAgent } from '../src/utility/roots/library-agent';

type AgentMain = MainServicesClient<'agent'>;

const DIMS = 16;
const SPACE: EmbeddingSpace = {
  model: 'test-hashing',
  revision: '1',
  dimensions: DIMS,
  indexName: 'test_hashing_1',
};
const UI = { source: 'ui', actor: 'user' } as const;

/** Feature-hashed words, unit length: texts sharing words are close. */
function hashVector(text: string): number[] {
  const vector = new Array<number>(DIMS).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < word.length; i++) hash = Math.imul(hash ^ word.charCodeAt(i), 0x01000193) >>> 0;
    const slot = hash % DIMS;
    vector[slot] = (vector[slot] ?? 0) + 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
}

/** Main as the agent sees it: only the jobs process's embeddings, serving SPACE (or not yet). */
function mainServing(serving: () => boolean): () => AgentMain {
  const embeddings: AgentMain['embeddings'] = {
    space: async () => {
      if (!serving()) throw new Error('not served yet');
      return SPACE;
    },
    embedTexts: async ({ texts }) => ({ vectors: texts.map(hashVector) }),
  };
  const client = { embeddings } as AgentMain;
  return () => client;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function agent(options: { serving?: () => boolean } = {}) {
  const db: LibraryDatabase = unwrap(openDatabase({ path: ':memory:', extensions: [sqliteVecPath()] }));
  const userData = mkdtempSync(join(tmpdir(), 'taalcut-template-index-'));
  const ports = createLibraryPorts(db);
  const events = createEventBus({ clock: systemClock });
  const bus = createCommandBus({ store: ports.auditLog, clock: systemClock });
  const container = createContainer()
    .value(ClockToken, systemClock)
    .value(EventBusToken, events)
    .value(CommandBusToken, bus)
    .value(LibraryDatabaseToken, db)
    .value(LibraryPortsToken, ports)
    .value(AgentMainServicesToken, mainServing(options.serving ?? (() => true)));
  const config: UtilityConfig = {
    process: 'agent',
    dbPath: ':memory:',
    userData,
    resourcesPath: userData,
    packaged: false,
    componentManifest: '',
  };
  registerLibraryAgent(container, config);
  const store = container.resolve(TemplateStoreToken);
  bus.register(
    ...createTemplateCommands({ service: createTemplateService({ store, clock: systemClock }), store }).all,
  );
  cleanups.push(() => rmSync(userData, { recursive: true, force: true }));
  cleanups.push(() => db.close());
  cleanups.push(() => container.dispose());
  const index = unwrap(openVectorIndex(db, { name: templateIndexName(SPACE.indexName), dimensions: DIMS }));
  /** The templates the index holds vectors for. */
  const indexed = () => new Set(unwrap(index.ids()).map((id) => parseTemplateVectorId(id)?.templateId));
  return { container, bus, events, store, indexed };
}

function vlogPlan(): Template {
  return unwrap(
    planFormat(
      { formatId: 'vlog', targetSeconds: 20, brief: 'a slow morning with coffee', createdAt: 1 },
      { template: () => newId(), slot: () => newId(), overlay: () => newId() },
    ),
  );
}

const fitInput = () =>
  fitTemplatesInputSchema.parse({ pool: { assetIds: [newId<'Asset'>()] }, templates: {}, limit: 5 });

describe('the template index in the agent process', () => {
  it('indexes a committed template command through the store the root binds', async () => {
    const env = agent();
    startTemplateIndex(env.container);
    const changed: string[] = [];
    env.events.on('library.changed', ({ payload }) => {
      if (payload.entity === 'template') changed.push(`${payload.change}:${payload.ids.join(',')}`);
    });
    const template = vlogPlan();
    unwrap(
      await env.bus.dispatch(
        TEMPLATE_COMMANDS.create,
        { projectId: null, template, name: 'Morning vlog', listed: true },
        UI,
      ),
    );
    expect(changed).toEqual([`created:${template.id}`]);
    await vi.waitFor(() => expect(env.indexed().has(template.id)).toBe(true));

    const found = unwrap(
      await env.container.resolve(TemplateSearchToken).search({
        text: 'morning vlog',
        includeUnlisted: false,
        includeArchived: false,
        limit: 5,
      }),
    );
    expect(found.degraded).toBeNull();
    expect(found.hits.map((hit) => hit.summary.id)).toEqual([template.id]);
    expect(found.hits[0]?.matchedBy).toEqual(expect.arrayContaining(['words', 'meaning']));

    const fitted = unwrap(await env.container.resolve(TemplateFitterToken).fitTemplates(fitInput()));
    expect(fitted.templates).toBe(1);
    expect(fitted.poolShots).toBe(0);
    expect(fitted.fits.map((fit) => [fit.summary.id, fit.covered])).toEqual([[template.id, 0]]);
  });

  it('catches up at start with templates written before it', async () => {
    const env = agent();
    const template = vlogPlan();
    unwrap(await env.store.create(template, { name: 'Written earlier', projectId: null, listed: true }));
    expect(env.indexed().size).toBe(0);
    startTemplateIndex(env.container);
    await vi.waitFor(() => expect(env.indexed().has(template.id)).toBe(true));
  });

  it('searches by words alone until the jobs process serves a space, and fit says why it cannot run', async () => {
    const env = agent({ serving: () => false });
    unwrap(await env.store.create(vlogPlan(), { name: 'Morning vlog', projectId: null, listed: true }));
    const found = unwrap(
      await env.container.resolve(TemplateSearchToken).search({
        text: 'morning vlog',
        includeUnlisted: false,
        includeArchived: false,
        limit: 5,
      }),
    );
    expect(found.degraded).toBe('keyword-only');
    expect(found.hits).toHaveLength(1);
    const fitted = await env.container.resolve(TemplateFitterToken).fitTemplates(fitInput());
    expect(fitted.ok ? null : fitted.error.code).toBe('vision.embedder_unavailable');
  });
});
