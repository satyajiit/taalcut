// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** appContract.templates in the agent process: not served without a TemplateStore, served with one. */
import { describe, expect, it } from 'vitest';
import {
  AuditLogStoreToken,
  ClockToken,
  CommandBusToken,
  createCommandBus,
  createContainer,
  createManualClock,
  createMemoryAuditLogStore,
  TEMPLATE_COMMANDS,
  TemplateStoreToken,
} from '@taalcut/core';
import { createMemoryTemplateStore } from '@taalcut/templates/test-support';
import { agentTemplatesRouter } from '../src/utility/roots/agent-templates';

function container() {
  const clock = createManualClock(1_760_000_000_000);
  const c = createContainer();
  c.value(ClockToken, clock);
  c.value(AuditLogStoreToken, createMemoryAuditLogStore());
  c.factory(CommandBusToken, ({ store }) => createCommandBus({ store, clock }), {
    deps: { store: AuditLogStoreToken },
  });
  return { c, clock };
}

describe('agent templates wiring', () => {
  it('leaves the namespace unserved until the library registers a TemplateStore', () => {
    const { c } = container();
    expect(agentTemplatesRouter(c)).toBeDefined();
    expect(
      c
        .resolve(CommandBusToken)
        .list()
        .some((command) => command.name === TEMPLATE_COMMANDS.create),
    ).toBe(false);
  });

  it('registers the template commands and serves the router over the store', () => {
    const { c, clock } = container();
    c.value(TemplateStoreToken, createMemoryTemplateStore(clock));
    const router = agentTemplatesRouter(c);
    expect(Object.keys(router).sort()).toEqual([
      'exportDocument',
      'fetchMedia',
      'folders',
      'formats',
      'get',
      'instagramCollections',
      'instagramReels',
      'instagramStatus',
      'list',
      'proposeEdits',
      'search',
      'starters',
      'styleProfile',
      'versions',
      'writeStyleSummary',
    ]);
    const names = c
      .resolve(CommandBusToken)
      .list()
      .map((command) => command.name);
    expect(names).toEqual(expect.arrayContaining([TEMPLATE_COMMANDS.create, TEMPLATE_COMMANDS.dropSlot]));
  });
});
