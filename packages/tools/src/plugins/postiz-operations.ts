// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import type { PluginTool } from '@taalcut/core';
import { postOperations } from './postiz-posts';
import { mediaOperations } from './postiz-media';
import type { PostizOperation } from './postiz-operation-schema';
export const identifier = z.string().min(1).max(500);
export const idInput = z.object({ id: identifier }).strict();
export const noInput = z.object({}).strict();

const integrationOperations: PostizOperation[] = [
  {
    name: 'listIntegrations',
    description: 'List connected social accounts, optionally for a customer group.',
    method: 'GET',
    path: '/integrations',
    access: ['channels-read'],
    schema: z.object({ group: identifier.optional() }).strict(),
  },
  {
    name: 'listGroups',
    description: 'List customer groups.',
    method: 'GET',
    path: '/groups',
    access: ['channels-read'],
    schema: noInput,
  },
  {
    name: 'getIntegrationUrl',
    description:
      'Create an OAuth connection link for a platform. The person completes sign-in in their browser.',
    method: 'GET',
    path: '/social/{integration}',
    access: ['channels-write'],
    external: true,
    schema: z.object({ integration: identifier, refresh: identifier.optional() }).strict(),
  },
  {
    name: 'getIntegrationSettings',
    description: 'Read platform rules, settings schema and available provider helper tools for a channel.',
    method: 'GET',
    path: '/integration-settings/{id}',
    access: ['channels-read'],
    schema: idInput,
  },
  {
    name: 'triggerIntegrationTool',
    description: 'Invoke a provider helper discovered in channel settings.',
    method: 'POST',
    path: '/integration-trigger/{id}',
    access: ['channels-write'],
    schema: z
      .object({ id: identifier, methodName: identifier, data: z.record(z.string(), z.string()).optional() })
      .strict(),
  },
  {
    name: 'deleteChannel',
    description: 'Delete a channel and its scheduled posts. Confirm affected content first.',
    method: 'DELETE',
    path: '/integrations/{id}',
    access: ['channels-write'],
    schema: idInput,
  },
  {
    name: 'isConnected',
    description: 'Verify the connected credential.',
    method: 'GET',
    path: '/is-connected',
    access: ['channels-read'],
    schema: noInput,
  },
  {
    name: 'getMe',
    description: 'Read the workspace and, for OAuth tokens, the approving user.',
    method: 'GET',
    path: '/me',
    access: ['channels-read'],
    schema: noInput,
  },
  {
    name: 'findSlot',
    description: 'Find the next available posting slot for a channel.',
    method: 'GET',
    path: '/find-slot/{id}',
    access: ['channels-read'],
    schema: idInput,
  },
  {
    name: 'getAnalytics',
    description: 'Read channel metrics. date is the number of days to look back, not a calendar date.',
    method: 'GET',
    path: '/analytics/{integration}',
    access: ['analytics-read'],
    schema: z.object({ integration: identifier, date: z.string().regex(/^\d+$/) }).strict(),
  },
  {
    name: 'getPostAnalytics',
    description: 'Read published-post metrics. date is the number of days to look back.',
    method: 'GET',
    path: '/analytics/post/{postId}',
    access: ['analytics-read'],
    schema: z.object({ postId: identifier, date: z.string().regex(/^\d+$/) }).strict(),
  },
  {
    name: 'listNotifications',
    description: 'Read publishing notifications, 100 per page. Pages start at zero.',
    method: 'GET',
    path: '/notifications',
    access: ['posts-read'],
    schema: z.object({ page: z.number().int().nonnegative().optional() }).strict(),
  },
];

export function postizOperations(): readonly PostizOperation[] {
  return [...integrationOperations, ...postOperations(), ...mediaOperations()];
}

export function operationTool(operation: PostizOperation): PluginTool {
  const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(operation.schema);
  return {
    name: `api.${operation.name}`,
    description: operation.description,
    inputSchema,
    access: operation.access,
    sideEffect: operation.method === 'GET' && !operation.external ? 'read' : 'external',
    source: 'api',
  };
}
