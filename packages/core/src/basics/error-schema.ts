// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * zod schemas for the error model, so a TaalcutError can be validated when it
 * arrives over IPC, inside an event or inside a card.
 */
import './zod-config';
import { z } from 'zod';
import type { FixAction, TaalcutError } from './errors';

export const fixActionSchema: z.ZodType<FixAction> = z.object({
  command: z.string().min(1),
  labelKey: z.string().min(1),
  payload: z.unknown().optional(),
});

const errorFields = {
  code: z.string().regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/),
  messageKey: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  retryable: z.boolean(),
  fix: fixActionSchema.optional(),
};

export const taalcutErrorSchema: z.ZodType<TaalcutError> = z.object({
  ...errorFields,
  detail: z.string().optional(),
});

/** An error as a window may see it: without `detail`, developer text that may quote a URL, a path or a cause. */
export type PublicError = Omit<TaalcutError, 'detail'>;

/**
 * The error inside anything a window can receive (events, cards, job
 * snapshots): parsing drops `detail`, so it never leaves the process that
 * raised it inside a payload. Thrown errors lose it the same way
 * (toServerRpcError).
 */
export const publicErrorSchema: z.ZodType<PublicError> = z.object(errorFields);
