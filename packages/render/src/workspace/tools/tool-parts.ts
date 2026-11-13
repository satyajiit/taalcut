// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What every workspace tool shares (HFW1 "dsn"): its version, cost class, network and retry, and an idempotency
 * key over its whole input, so a resumed run never writes or places the same thing twice.
 */
import { createHash } from 'node:crypto';
import { defineTool, type ToolSpec } from '@taalcut/core';
import type { z } from 'zod';

// 1.0.0 (HFW1): the workspace tools.
export const TOOLS_VERSION = '1.0.0';

export const LOCAL = { network: 'none' } as const;
export const READ_RETRY = { maxAttempts: 2, initialDelayMs: 300 };

/** sha256 over the tool's name and its input. */
export const keyOf =
  (name: string) =>
  (input: unknown): string =>
    createHash('sha256').update(JSON.stringify([name, input])).digest('hex');

/** A human label for a workspace path in tool call summaries ("vietnam-chat/index.html" → "Vietnam chat"). */
export function entryLabel(path: string): string {
  if (path === '_taalcut/brief.md') return 'Design brief';
  const match = /^([^/]+)\/index\.html$/i.exec(path.trim());
  if (!match?.[1]) return path;
  const words = match[1].replace(/[-_]+/g, ' ').trim();
  return words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : path;
}

/** defineTool with the module's version, run on this Mac unless the spec says otherwise. */
export function workspaceTool<I extends z.ZodType, O extends z.ZodType, const C extends string | undefined = undefined>(
  spec: Omit<ToolSpec<I, O, C>, 'version' | 'costClass'> & Partial<Pick<ToolSpec<I, O, C>, 'costClass'>>,
): ToolSpec<I, O, C> {
  return defineTool<I, O, C>({ version: TOOLS_VERSION, costClass: 'local', ...spec } as ToolSpec<I, O, C>);
}
