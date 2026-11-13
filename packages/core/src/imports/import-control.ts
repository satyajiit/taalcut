// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { z } from 'zod';
import { ipc } from '../ipc/contract';
import { IMPORT_COMMANDS as C, importCommandPayloads as P } from './import-commands';

/** Agent command handlers forward here after the command bus validates and audits the operation. */
export const importOperationSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal(C.ejectSource), payload: P[C.ejectSource] }),
  z.object({ name: z.literal(C.createDraft), payload: P[C.createDraft] }),
  z.object({ name: z.literal(C.updateDraft), payload: P[C.updateDraft] }),
  z.object({ name: z.literal(C.discardDraft), payload: P[C.discardDraft] }),
  z.object({ name: z.literal(C.start), payload: P[C.start] }),
  z.object({ name: z.literal(C.pause), payload: P[C.pause] }),
  z.object({ name: z.literal(C.resume), payload: P[C.resume] }),
  z.object({ name: z.literal(C.cancel), payload: P[C.cancel] }),
  z.object({ name: z.literal(C.retryFailed), payload: P[C.retryFailed] }),
]);
export type ImportOperation = z.output<typeof importOperationSchema>;
export const importsControlContract = { execute: ipc.input(importOperationSchema).output(z.unknown()) };
