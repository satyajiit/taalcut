// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stock media (P3-V18): search results from Pexels (video) and Freesound (sound effects), their licences, and the
 * search and import shapes. The agent process searches and fetches; previews reach a window only through
 * app://media/stock/<sha256> (the CSP loads no remote image). Provider text is untrusted: plain only.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { STOCK_PREVIEW_URL_PATTERN } from '../basics/csp';
import { idSchema } from '../basics/ids';

export const STOCK_PROVIDERS = ['pexels', 'freesound'] as const;
export type StockProviderId = (typeof STOCK_PROVIDERS)[number];
export const STOCK_LICENCES = ['Pexels-Licence', 'CC0-1.0', 'CC-BY-4.0'] as const;
export type StockLicence = (typeof STOCK_LICENCES)[number];
export const STOCK_KINDS = ['video', 'soundEffect'] as const;
export type StockKind = (typeof STOCK_KINDS)[number];
export const STOCK_ORIENTATIONS = ['portrait', 'landscape', 'square'] as const;

export const stockResultSchema = z.object({
  provider: z.enum(STOCK_PROVIDERS),
  providerId: z.string().max(100),
  kind: z.enum(STOCK_KINDS),
  /** Untrusted: plain text. */
  title: z.string().max(300),
  author: z.object({ name: z.string().max(200), url: z.url().max(2048).nullable() }),
  pageUrl: z.url().max(2048),
  licence: z.enum(STOCK_LICENCES),
  seconds: z.number().positive().nullable(),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  fps: z.number().positive().nullable(),
  /** app://media/stock/<sha256>.<jpg|webp>, fetched by the agent process. */
  preview: z.string().regex(STOCK_PREVIEW_URL_PATTERN),
  /** Which file of the item to fetch (a Pexels rendition, a Freesound preview or original). */
  renditionKey: z.string().max(100),
  /** The asset this item already is in the library. */
  alreadyImported: idSchema<'Asset'>().nullable(),
});
export type StockResult = z.output<typeof stockResultSchema>;

export const stockSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    kind: z.enum(STOCK_KINDS),
    orientation: z.enum(STOCK_ORIENTATIONS).optional(),
    minSeconds: z.number().positive().max(600).optional(),
    maxSeconds: z.number().positive().max(600).optional(),
    page: z.int().min(1).max(50).default(1),
  })
  .refine((input) => !input.minSeconds || !input.maxSeconds || input.minSeconds <= input.maxSeconds, {
    message: 'minSeconds is more than maxSeconds',
    path: ['maxSeconds'],
  });
export type StockSearchInput = z.output<typeof stockSearchInputSchema>;

export const stockSearchPageSchema = z.object({
  items: z.array(stockResultSchema).max(80),
  /** Providers with no key, off in this build, or refused by Local only. */
  providersOff: z.array(z.enum(STOCK_PROVIDERS)).max(STOCK_PROVIDERS.length),
});
export type StockSearchPage = z.output<typeof stockSearchPageSchema>;

/** What library.importStock fetches. */
export const stockItemRefSchema = z.object({
  provider: z.enum(STOCK_PROVIDERS),
  providerId: z.string().max(100),
  kind: z.enum(STOCK_KINDS),
  renditionKey: z.string().max(100),
});
export type StockItemRef = z.output<typeof stockItemRefSchema>;

/** The credit lines a set of assets needs: the ones a licence requires, and courtesy ones. */
export const creditsSchema = z.object({
  required: z.array(z.string().max(500)).max(400),
  courtesy: z.array(z.string().max(500)).max(400),
});
export type Credits = z.output<typeof creditsSchema>;
