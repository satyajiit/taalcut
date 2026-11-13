// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Parts every card file shares. Internal: the index exports the cards, not these. */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { moneySchema } from '../basics/money';

/** Every card has a stable id (re-sending the same id updates the card in place) and a version. */
export const base = { id: z.string().min(1), version: z.literal(1) };
export const runId = idSchema<'AgentRun'>();

/** What something costs or used: money, tokens, time. */
export const amounts = z.object({
  money: moneySchema.optional(),
  tokens: z.int().nonnegative().optional(),
  durationMs: z.int().nonnegative().optional(),
});

/**
 * Who asked, when it wasn't the built-in agent: an external agent's session (P3-V4). On approval cards since
 * round P3-1; on consent and project-cap cards since round P3-3. Exported from cards.ts.
 */
export const cardRequesterSchema = z.object({
  kind: z.literal('mcp'),
  sessionId: idSchema<'McpSession'>(),
  name: z.string().max(60),
});
