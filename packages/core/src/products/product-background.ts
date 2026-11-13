// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
export const productWakeContract = {
  wake: ipc.input(z.object({})).output(z.object({ completed: z.int().nonnegative() })),
};
import { ipc } from '../ipc/contract';

export const productBackgroundStatusSchema = z.object({
  enabled: z.boolean(),
  supported: z.boolean(),
  registration: z.enum(['disabled', 'enabled', 'approval-required', 'unavailable', 'failed']),
  detail: z.string().max(2000).nullable(),
});
export type ProductBackgroundStatus = z.output<typeof productBackgroundStatusSchema>;
export const productBackgroundContract = {
  status: ipc.input(z.object({})).output(productBackgroundStatusSchema),
};
/** Main-owned OS registration; only the command owner receives mutation access. */
export const productBackgroundControlContract = {
  ...productBackgroundContract,
  setEnabled: ipc.input(z.object({ enabled: z.boolean() })).output(productBackgroundStatusSchema),
};
