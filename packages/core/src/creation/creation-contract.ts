// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import { authoredInspectionSchema, type AuthoredInspection } from './authored-program';
import { creationProjectSchema, type CreationProject } from './creation-types';

export const creationGetInputSchema = z.object({ projectId: idSchema<'Project'>() });
export const creationInspectInputSchema = creationGetInputSchema.extend({
  timelineId: idSchema<'Timeline'>(),
});
export type CreationGetInput = z.output<typeof creationGetInputSchema>;
export type CreationInspectInput = z.output<typeof creationInspectInputSchema>;
export const creationContract = {
  list: ipc.input(z.object({})).output(z.object({ items: z.array(creationProjectSchema).max(200) })),
  get: ipc.input(creationGetInputSchema).output(creationProjectSchema),
  inspect: ipc.input(creationInspectInputSchema).output(authoredInspectionSchema),
};
export interface CreationService {
  list(): AsyncResult<{ items: CreationProject[] }>;
  get(input: CreationGetInput): AsyncResult<CreationProject>;
  inspect(input: CreationInspectInput): AsyncResult<AuthoredInspection>;
}
export function creationRouter(service: CreationService) {
  const os = implementContract(creationContract);
  return os.router({
    list: os.list.handler(async () => unwrapRpc(await service.list())),
    get: os.get.handler(async ({ input }) => unwrapRpc(await service.get(input))),
    inspect: os.inspect.handler(async ({ input }) => unwrapRpc(await service.inspect(input))),
  });
}
