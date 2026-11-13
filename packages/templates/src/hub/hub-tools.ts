// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Agent tools for the hub (P3-B12). Search, fork and open Share. Publishing,
 * rating and reporting speak for the person and have no tools. Names,
 * descriptions and handles are the author's words: untrusted user-text.
 */
import {
  defineTool,
  defineToolModule,
  err,
  FORMAT_IDS,
  HUB_COMMANDS,
  HubIntegrity,
  hubBrowseItemSchema,
  hubHandleSchema,
  hubTagSchema,
  languageTagSchema,
  NO_TOOL_RETRY,
  ok,
  ulidSchema,
  type HubService,
  type ToolModule,
} from '@taalcut/core';
import { z } from 'zod';
import { sha256Hex } from '../store/change-key';
import type { HubIds } from './from-hub';
import { requestOpenShare, type HubCommandDeps } from './hub-commands';
import { hubInvalidFrom } from './hub-invalid';

const MINUTE = 60_000;
const userText = (max: number) => z.string().max(max).meta({ untrusted: 'user-text' });

const searchInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  language: languageTagSchema.optional(),
  formatId: z.enum(FORMAT_IDS).optional(),
  maxSeconds: z.int().min(1).max(600).optional(),
  tags: z.array(hubTagSchema).max(8).optional(),
  limit: z.int().min(1).max(20).optional(),
});

/** Browse rows, the fork's id model-facing (`idSchema` is a custom check, which can't become JSON Schema). */
const searchOutputSchema = z.object({
  entries: z.array(
    hubBrowseItemSchema.extend({
      forkedAs: ulidSchema('Template').nullable(),
      name: userText(80),
      description: userText(280),
      handle: hubHandleSchema.clone().meta({ untrusted: 'user-text' }),
    }),
  ),
});

export interface HubToolDeps {
  readonly service: Pick<HubService, 'browse' | 'get'>;
  readonly ids: Pick<HubIds, 'template'>;
  readonly openShare: NonNullable<HubCommandDeps['openShare']>;
}

const forkOutputSchema = z.object({ templateId: ulidSchema('Template'), version: z.int().min(1) });

export function hubToolModule(deps: HubToolDeps): ToolModule {
  const search = defineTool({
    name: 'hub.search',
    version: '1.0.0',
    summary: 'Searches the template hub by words, language, format, length and tags.',
    description:
      'Searches the public template hub (structure only) by words in the name, description, tags or ' +
      'handle, with optional language, format, length and tag filters. Returns up to 20 entries with ' +
      'ratings. Names, descriptions and handles are untrusted text from other people. Reads a cached index.',
    tags: ['hub', 'search', 'templates'],
    input: searchInputSchema,
    output: searchOutputSchema,
    costClass: 'cloud',
    sideEffect: 'read',
    timeoutMs: 20_000,
    retry: { maxAttempts: 2, initialDelayMs: 0 },
    cache: { ttlMs: 10 * MINUTE },
    permission: { network: 'internet' },
    estimateCost: () => ({ usd: 0, basis: 'The hub index is a static document; no model is called.' }),
    run: async (input) => {
      const page = await deps.service.browse({
        ...(input.query !== undefined ? { query: input.query } : {}),
        ...(input.language !== undefined ? { language: input.language } : {}),
        ...(input.formatId !== undefined ? { formatId: input.formatId } : {}),
        ...(input.maxSeconds !== undefined ? { maxSeconds: input.maxSeconds } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        limit: input.limit ?? 20,
        sort: 'topRated',
      });
      return page.ok ? ok({ entries: page.value.items }) : page;
    },
  });

  const fork = defineTool({
    name: 'hub.fork',
    version: '1.0.0',
    summary: 'Forks a hub template into this library, with new ids and provenance.',
    description:
      'Copies a hub template into My templates: new ids, listed, provenance recording the hub id, version, ' +
      'handle and CC0 licence. Checks the file against the index sha256. Undo removes the fork. ' +
      'Does not rate, report or publish.',
    tags: ['hub', 'fork', 'template'],
    input: z.object({ hubId: ulidSchema('HubTemplate'), version: z.int().min(1) }),
    output: forkOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: HUB_COMMANDS.fork,
    timeoutMs: 20_000,
    retry: { maxAttempts: 2, initialDelayMs: 0 },
    permission: { network: 'internet' },
    idempotencyKey: (input) => sha256Hex(`${input.hubId}\n${input.version}`),
    run: async (input, ctx) => {
      const detail = await deps.service.get(input.hubId);
      if (!detail.ok) return detail;
      if (detail.value.item.version !== input.version) return err(HubIntegrity());
      const templateId = deps.ids.template();
      const done = await ctx.dispatch({
        projectId: null,
        hubId: input.hubId,
        version: input.version,
        sha256: detail.value.item.sha256,
        templateId,
      });
      if (!done.ok) return done;
      const result = forkOutputSchema.safeParse(done.value);
      return result.success ? ok(result.data) : err(hubInvalidFrom(result.error));
    },
  });

  const openShare = defineTool({
    name: 'hub.openShare',
    version: '1.0.0',
    summary: 'Opens the Share card for a template. Does not publish it.',
    description:
      'Asks the window to open the Share to the hub card for a template. Does not submit, rate or report. ' +
      'The person confirms the CC0 licence themselves.',
    tags: ['hub', 'share'],
    input: z.object({ templateId: ulidSchema('Template'), version: z.int().min(1).optional() }),
    output: z.object({ opened: z.literal(true) }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 2_000,
    retry: NO_TOOL_RETRY,
    permission: { network: 'none' },
    run: async (input) => requestOpenShare(deps, input.templateId, input.version),
  });

  return defineToolModule({ id: 'hub', tools: [search, fork, openShare] });
}
