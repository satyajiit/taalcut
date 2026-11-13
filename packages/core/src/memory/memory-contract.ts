// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.memory (LRN1-MEM), owner agent: read-only, served over the library's MemoryStore; changes are
 * MEMORY_COMMANDS. `status` says plainly where memory goes: whether the next run includes it, and in prompts to
 * which cloud providers. Settings → Memory re-reads on `library.changed` (entity 'memory') and on `command.changed`
 * for memory, privacy and models commands.
 */
import '../basics/zod-config';
import { z } from 'zod';
import type { AsyncResult } from '../basics/result';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import { MEMORY_SCOPES, memoryItemViewSchema } from './memory-schema';
import { MEMORY_LIST_MAX } from './memory-store';

export const memoryListInputSchema = z.object({
  /** Words in the text (keyword match, best first). Absent: newest first. */
  query: z.string().trim().max(200).optional(),
  scope: z.enum(MEMORY_SCOPES).optional(),
});
export type MemoryListInput = z.output<typeof memoryListInputSchema>;

export const memoryListSchema = z.object({
  items: z.array(memoryItemViewSchema).max(MEMORY_LIST_MAX),
  /** Every item that matches, beyond the first MEMORY_LIST_MAX too. */
  total: z.int().nonnegative(),
});
export type MemoryList = z.output<typeof memoryListSchema>;

/**
 * What the next run does with memory. on-device: included, and its prompts stay on this Mac (Local only, or every
 * prompt model runs here). cloud: included in prompts to the cloud providers listed. withheld: not included, because
 * the prompts may leave the Mac and MEMORY_CLOUD_PROMPTS_SETTING is off.
 */
export const MEMORY_PROMPT_USES = ['on-device', 'cloud', 'withheld'] as const;
export type MemoryPromptUse = (typeof MEMORY_PROMPT_USES)[number];

export const memoryStatusSchema = z.object({
  /** MEMORY_CLOUD_PROMPTS_SETTING, the person's choice (kept while Local only pauses it). */
  cloudPrompts: z.boolean(),
  localOnly: z.boolean(),
  /** Where the agent's prompts run now (the agent module and the skills' modules, as privacy's overview says). */
  runsOn: z.enum(['this-mac', 'cloud', 'both', 'off']),
  /** Cloud provider ids the prompts may go to, in chain order; empty when they stay here. */
  providers: z.array(z.string().min(1)).max(16),
  prompts: z.enum(MEMORY_PROMPT_USES),
  counts: z.object({
    user: z.int().nonnegative(),
    project: z.int().nonnegative(),
    template: z.int().nonnegative(),
  }),
});
export type MemoryStatus = z.output<typeof memoryStatusSchema>;

export const memoryContract = {
  list: ipc.input(memoryListInputSchema).output(memoryListSchema),
  status: ipc.output(memoryStatusSchema),
};

/** What the agent process serves appContract.memory from (@taalcut/agent's memory service). */
export interface MemoryService {
  list(input: MemoryListInput): AsyncResult<MemoryList>;
  status(): AsyncResult<MemoryStatus>;
}

export function memoryRouter(service: MemoryService) {
  const os = implementContract(memoryContract);
  return os.router({
    list: os.list.handler(async ({ input }) => unwrapRpc(await service.list(input))),
    status: os.status.handler(async () => unwrapRpc(await service.status())),
  });
}
