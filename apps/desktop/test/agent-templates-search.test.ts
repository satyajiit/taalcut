// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LRN1-TPL: templates.search in the agent process answers from the template index's search (TemplateSearchToken). */
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuditLogStoreToken,
  ClockToken,
  CommandBusToken,
  connectRpc,
  createCommandBus,
  createContainer,
  createManualClock,
  createMemoryAuditLogStore,
  ok,
  serveRpc,
  templatesContract,
  TemplateSearchToken,
  TemplateStoreToken,
  type TemplateSearch,
} from '@taalcut/core';
import { createMemoryTemplateStore } from '@taalcut/templates/test-support';
import { agentTemplatesRouter } from '../src/utility/roots/agent-templates';

const ports: MessageChannel[] = [];
afterEach(() => {
  for (const channel of ports.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

/** The templates namespace over a template store, with this search registered when one is given. */
function clientWith(search?: TemplateSearch) {
  const clock = createManualClock(1_760_000_000_000);
  const c = createContainer();
  c.value(ClockToken, clock);
  c.value(AuditLogStoreToken, createMemoryAuditLogStore());
  c.factory(CommandBusToken, ({ store }) => createCommandBus({ store, clock }), {
    deps: { store: AuditLogStoreToken },
  });
  c.value(TemplateStoreToken, createMemoryTemplateStore(clock));
  if (search) c.value(TemplateSearchToken, search);
  const channel = new MessageChannel();
  ports.push(channel);
  serveRpc(agentTemplatesRouter(c), channel.port1, { context: {} });
  return connectRpc(templatesContract, channel.port2, { peer: 'agent' }).client;
}

describe('templates.search in the agent process', () => {
  it('answers from the template index, words only while it reads words only', async () => {
    const search = vi.fn<TemplateSearch['search']>(async () =>
      ok({ hits: [], degraded: 'keyword-only' as const, fusion: 'template-search-v1' }),
    );
    const client = clientWith({ search });
    await expect(client.search({ text: '  feet in the sand ', favourite: true })).resolves.toEqual({
      hits: [],
      degraded: 'keyword-only',
      fusion: 'template-search-v1',
    });
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'feet in the sand', limit: 10, favourite: true }),
    );
  });

  it('is not served where the library database (and so the index) is not open', async () => {
    const client = clientWith();
    await expect(client.search({ text: 'sea' })).rejects.toMatchObject({
      data: { code: 'core.not_implemented' },
    });
  });
});
