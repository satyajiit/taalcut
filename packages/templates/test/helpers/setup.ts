// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Core's real command bus over a memory audit log, with the template commands on the memory store. */
import {
  createCommandBus,
  createManualClock,
  createMemoryAuditLogStore,
  newId,
  type CommandOrigin,
  type ProjectId,
} from '@taalcut/core';
import { createTemplateCommands, createTemplateService } from '../../src/index';
import { createMemoryTemplateStore } from '../../src/test-support';

export const UI: CommandOrigin = { source: 'ui', actor: 'user' };
export const AGENT: CommandOrigin = { source: 'agent', actor: 'agent:run' };

/** `libraryMetadata`: the memory store serves P3-V14's filters, so library tests say so. */
export function setupTemplates(options: { readonly libraryMetadata?: boolean } = {}) {
  const clock = createManualClock(1_760_000_000_000);
  const store = createMemoryTemplateStore(clock);
  const audit = createMemoryAuditLogStore();
  const bus = createCommandBus({ store: audit, clock });
  const service = createTemplateService({ store, clock, libraryMetadata: options.libraryMetadata ?? false });
  const commands = createTemplateCommands({ service, store });
  bus.register(...commands.all);
  const projectA = newId<'Project'>() as ProjectId;
  const projectB = newId<'Project'>() as ProjectId;
  return { clock, store, audit, bus, service, commands, projectA, projectB };
}
