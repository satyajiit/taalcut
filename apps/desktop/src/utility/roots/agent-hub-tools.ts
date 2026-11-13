// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's hub tools (P3-B12): `hub.search`, `hub.fork` and `hub.openShare` over the same hub client the `hub`
 * router serves (agent-hub-client.ts). Offered only once the library has registered the hub stores.
 */
import type { Container, ToolModule } from '@taalcut/core';
import { hubToolModule } from '@taalcut/templates';
import { hubClientOf, hubIds } from './agent-hub-client';

export function hubToolModules(container: Container): ToolModule[] {
  const client = hubClientOf(container);
  if (!client) return [];
  return [hubToolModule({ service: client.service, ids: hubIds(), openShare: client.openShare })];
}
