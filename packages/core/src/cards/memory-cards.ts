// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-MEM: memory.remember's approval card ("Remember this?"). It shows at every autonomy level (the tool is
 * `alwaysAsk`) and is answered like an approval card (chat.decideApproval with `approvalId`). Approved, the tool runs
 * and the card turns `remembered` with the item's id; declined, nothing is stored.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { memoryScopeSchema, memoryTextSchema } from '../memory/memory-schema';
import { base, runId } from './card-parts';

export const memoryProposalCardSchema = z.object({
  type: z.literal('memoryProposal'),
  ...base,
  runId,
  approvalId: z.string().min(1),
  /** The model's words: data, shown as written. */
  text: memoryTextSchema,
  scope: memoryScopeSchema,
  /** The project's or template's name; null in the user scope. */
  scopeName: z.string().max(200).nullable(),
  /** approved: the user said yes and the item is being stored; remembered: it is stored (`memoryId`). */
  status: z.enum(['pending', 'approved', 'remembered', 'declined', 'expired']),
  memoryId: idSchema<'MemoryItem'>().optional(),
});
