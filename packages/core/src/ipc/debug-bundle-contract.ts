// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Debug bundle sections (P2-X5): each process collects its own redacted
 * sections (UTILITY_CONTRACTS.agent.debugBundle, .jobs.debugBundle); main
 * assembles, scans and sends or saves them (feedback-contract.ts). Chat text
 * is left out unless the user includes it; paths and secrets are replaced.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { ipc } from './contract';
import { PROCESS_NAMES } from './processes';

export const DEBUG_SECTIONS = [
  'environment',
  'logs',
  'traces',
  'runs',
  'cloudCalls',
  'jobs',
  'components',
  'settings',
  'recovery',
] as const;

const count = z.int().nonnegative();

export const debugCollectOptionsSchema = z.object({
  /** Runs included in full. Default: the last 10. */
  runIds: z.array(idSchema<'AgentRun'>()).max(50).optional(),
  /** What the user typed and the agent wrote. Off: replaced by its length and a hash. */
  includeChatText: z.boolean().default(false),
  /** Default: the last 24 h. */
  sinceMs: z.int().nonnegative().optional(),
});
export type DebugCollectOptions = z.output<typeof debugCollectOptionsSchema>;

export const debugSectionSchema = z.object({
  section: z.enum(DEBUG_SECTIONS),
  process: z.enum(PROCESS_NAMES),
  /** Path inside the bundle, e.g. 'agent/runs/<runId>.jsonl'. */
  path: z.string().regex(/^[a-z]+(\/[A-Za-z0-9._-]+)+$/),
  mediaType: z.enum(['application/json', 'application/x-ndjson', 'text/plain']),
  text: z.string().max(8 * 1024 * 1024),
  /** For the preview: what was replaced. */
  redactions: z.object({ text: count, paths: count, secrets: count }),
});
export type DebugSection = z.output<typeof debugSectionSchema>;

export const debugBundleContract = {
  collect: ipc.input(debugCollectOptionsSchema).output(z.array(debugSectionSchema)),
};
