// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { eventIterator, ipc } from '../ipc/contract';
import {
  importDraftSchema,
  importItemOutcomeSchema,
  importItemSchema,
  importMethodSchema,
  importPreflightSchema,
  importSessionSchema,
} from './import-types';

const pagination = { cursor: z.string().max(200).optional(), limit: z.int().min(1).max(200).default(100) };
const draft = z.object({ draftId: idSchema<'ImportDraft'>() });
const sessions = z.object({ items: z.array(importSessionSchema), nextCursor: z.string().optional() });
export const importSourceSchema = z.object({
  id: z.string().min(1).max(200),
  method: importMethodSchema,
  label: z.string().max(1024),
  available: z.boolean(),
  status: z.string().max(200).nullable(),
});
export type ImportSource = z.output<typeof importSourceSchema>;
export const importsContract = {
  sources: ipc.input(z.object({ method: importMethodSchema.optional() })).output(z.array(importSourceSchema)),
  drafts: ipc.output(z.array(importDraftSchema)),
  draft: ipc.input(draft).output(importDraftSchema.nullable()),
  items: ipc
    .input(
      draft.extend({ ...pagination, query: z.string().max(200).optional(), onlyNew: z.boolean().optional() }),
    )
    .output(
      z.object({
        items: z.array(importItemSchema),
        total: z.int().nonnegative(),
        nextCursor: z.string().optional(),
      }),
    ),
  preflight: ipc.input(draft).output(importPreflightSchema),
  history: ipc
    .input(z.object({ ...pagination, methods: z.array(importMethodSchema).max(8).optional() }))
    .output(sessions),
  session: ipc.input(z.object({ sessionId: idSchema<'ImportSession'>(), ...pagination })).output(
    z
      .object({
        session: importSessionSchema,
        items: z.array(importItemOutcomeSchema),
        nextCursor: z.string().optional(),
      })
      .nullable(),
  ),
  /** Always emits the current snapshot first; subscribing never starts work. */
  watch: ipc
    .input(z.object({ sessionId: idSchema<'ImportSession'>().optional() }))
    .output(eventIterator(z.object({ sessions: z.array(importSessionSchema) }))),
};
