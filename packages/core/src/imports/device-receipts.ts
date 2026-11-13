// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';
import { idSchema } from '../basics/ids';
import { ipc } from '../ipc/contract';

export const deviceReceiptSchema = z.object({
  key: z.string().regex(/^[A-Z2-7]{16}$/),
  name: z.string().max(255),
  sizeBytes: z.int().nonnegative(),
  state: z.enum([
    'queued',
    'pulling',
    'checking',
    'importing',
    'imported',
    'duplicate',
    'in-icloud',
    'rejected',
    'failed',
    'cancelled',
  ]),
  assetId: idSchema<'Asset'>().nullable(),
  sourceId: idSchema<'Source'>().nullable(),
  error: publicErrorSchema.nullable(),
});
export type DeviceReceipt = z.output<typeof deviceReceiptSchema>;
export const deviceRunItemsProcedure = ipc
  .input(
    z.object({
      runId: idSchema<'DeviceImportRun'>(),
      cursor: z.string().max(200).optional(),
      limit: z.int().min(1).max(500).default(200),
    }),
  )
  .output(z.object({ items: z.array(deviceReceiptSchema), nextCursor: z.string().optional() }));
