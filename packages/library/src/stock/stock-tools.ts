// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Agent tools `stock.search` and `stock.import`. Search is a cloud read.
 * Import dispatches `library.importStock` and returns that command's result
 * (a job id, or an asset id when the item is already in the library). It does
 * not wait for the download job to finish.
 */
import {
  defineTool,
  defineToolModule,
  err,
  idSchema,
  NO_TOOL_RETRY,
  ok,
  STOCK_KINDS,
  STOCK_LICENCES,
  STOCK_ORIENTATIONS,
  STOCK_PREVIEW_URL_PATTERN,
  STOCK_PROVIDERS,
  stockItemRefSchema,
  ValidationError,
  type ToolModule,
} from '@taalcut/core';
import { z } from 'zod';
import { stockImportKey } from './stock-import';
import type { StockSearch } from './stock-search';

const DAY_MS = 24 * 60 * 60 * 1000;
const fromWeb = <T extends z.ZodType>(schema: T) => schema.meta({ untrusted: 'web' });

const searchInput = z
  .object({
    query: z.string().trim().min(1).max(200),
    kind: z.enum(STOCK_KINDS),
    orientation: z.enum(STOCK_ORIENTATIONS).optional(),
    minSeconds: z.number().positive().max(600).optional(),
    maxSeconds: z.number().positive().max(600).optional(),
    page: z.int().min(1).max(50).default(1),
    limit: z.int().min(1).max(12).default(12),
  })
  .refine((input) => !input.minSeconds || !input.maxSeconds || input.minSeconds <= input.maxSeconds, {
    message: 'minSeconds is more than maxSeconds',
    path: ['maxSeconds'],
  });

const searchOutput = z.object({
  items: z
    .array(
      z.object({
        provider: z.enum(STOCK_PROVIDERS),
        providerId: z.string().max(100),
        kind: z.enum(STOCK_KINDS),
        title: fromWeb(z.string().max(300)),
        author: z.object({
          name: fromWeb(z.string().max(200)),
          url: fromWeb(z.url().max(2048)).nullable(),
        }),
        pageUrl: fromWeb(z.url().max(2048)),
        licence: z.enum(STOCK_LICENCES),
        seconds: z.number().positive().nullable(),
        width: z.int().positive().nullable(),
        height: z.int().positive().nullable(),
        fps: z.number().positive().nullable(),
        preview: fromWeb(z.string().regex(STOCK_PREVIEW_URL_PATTERN)),
        renditionKey: z.string().max(100),
        alreadyImported: idSchema<'Asset'>().nullable(),
      }),
    )
    .max(12),
  providersOff: z.array(z.enum(STOCK_PROVIDERS)).max(STOCK_PROVIDERS.length),
});

const importInput = z.object({
  importId: idSchema<'StockImport'>(),
  item: stockItemRefSchema,
  projectId: idSchema<'Project'>().nullable().default(null),
});

const importOutput = z.object({
  importId: idSchema<'StockImport'>(),
  jobId: idSchema<'Job'>().nullable(),
  assetId: idSchema<'Asset'>().nullable(),
});

export interface StockToolDeps {
  readonly search: StockSearch;
}

export function stockToolModule(deps: StockToolDeps): ToolModule {
  const search = defineTool({
    name: 'stock.search',
    version: '1.0.0',
    description:
      "Searches Pexels video (and Freesound, when that build flag is on) with the user's own key. " +
      'Returns plain-text titles and authors, a licence, and an app:// preview. A missing key lists the ' +
      'provider in providersOff and does not call the network. Local only refuses the search.',
    summary: "Searches stock video with the user's provider key.",
    tags: ['stock', 'search', 'pexels'],
    input: searchInput,
    output: searchOutput,
    costClass: 'cloud',
    sideEffect: 'read',
    timeoutMs: 20_000,
    retry: { maxAttempts: 2, initialDelayMs: 500 },
    cache: { ttlMs: DAY_MS },
    permission: { network: 'internet' },
    estimateCost: () => ({ usd: 0, tokens: 0 }),
    run: async (input, ctx) => {
      const { limit, ...query } = input;
      const page = await deps.search.search(query, ctx.signal);
      if (!page.ok) return page;
      const parsed = searchOutput.safeParse({ ...page.value, items: page.value.items.slice(0, limit) });
      return parsed.success ? ok(parsed.data) : err(ValidationError({ field: 'stock.search' }));
    },
  });

  const importStock = defineTool({
    name: 'stock.import',
    version: '1.0.0',
    description:
      'Imports one stock item already returned by stock.search. Dispatches library.importStock, which ' +
      'enqueues the download. The result is the command result: jobId is set until the job finishes, and ' +
      'assetId is set immediately only when that provider id is already in the library.',
    summary: 'Imports a stock item by enqueueing its download.',
    tags: ['stock', 'import'],
    input: importInput,
    output: importOutput,
    costClass: 'local',
    sideEffect: 'write',
    command: 'library.importStock',
    timeoutMs: 6 * 60 * 1000,
    retry: NO_TOOL_RETRY,
    idempotencyKey: (input) => stockImportKey(input.item),
    permission: { network: 'internet', filesystem: { write: ['library'] } },
    run: async (input, ctx) => {
      const done = await ctx.dispatch(input);
      if (!done.ok) return done;
      const parsed = importOutput.safeParse(done.value);
      return parsed.success ? ok(parsed.data) : err(ValidationError({ field: 'stock.import' }));
    },
  });

  return defineToolModule({ id: 'stock', tools: [search, importStock] });
}
