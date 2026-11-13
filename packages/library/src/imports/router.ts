// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  defineCommand,
  implementContract,
  IMPORT_COMMANDS as C,
  importCommandPayloads as P,
  importOperationSchema,
  importsContract,
  importsControlContract,
  ok,
  unwrapRpc,
  type AsyncResult,
  type ImportOperation,
  type ImportSource,
} from '@taalcut/core';
import type { ImportSessionService } from './service';

export function importsRouter(
  service: ImportSessionService,
  sources: () => Promise<ImportSource[]> = async () => [],
) {
  const os = implementContract(importsContract);
  return os.router({
    sources: os.sources.handler(async ({ input }) =>
      (await sources()).filter((source) => !input.method || source.method === input.method),
    ),
    drafts: os.drafts.handler(() => service.drafts()),
    draft: os.draft.handler(({ input }) => service.draft(input.draftId)),
    items: os.items.handler(({ input }) => service.items(input)),
    preflight: os.preflight.handler(async ({ input }) => unwrapRpc(await service.preflight(input.draftId))),
    history: os.history.handler(({ input }) => service.history(input)),
    session: os.session.handler(({ input }) => service.session(input)),
    watch: os.watch.handler(async function* ({ input, signal }) {
      yield* service.watch(input, signal ?? new AbortController().signal);
    }),
  });
}
export function executeImportOperation(
  service: ImportSessionService,
  operation: ImportOperation,
): AsyncResult<unknown> {
  switch (operation.name) {
    case C.ejectSource:
      return service.ejectSource(operation.payload.sourceId);
    case C.createDraft:
      return service.createDraft(operation.payload);
    case C.updateDraft:
      return service.updateDraft(operation.payload);
    case C.discardDraft:
      return service.discardDraft(operation.payload.draftId);
    case C.start:
      return service.start(operation.payload.draftId);
    case C.pause:
      return service.pause(operation.payload.sessionId);
    case C.resume:
      return service.resume(operation.payload.sessionId);
    case C.cancel:
      return service.cancel(operation.payload.sessionId);
    case C.retryFailed:
      return service.retryFailed(operation.payload.sessionId);
  }
}
export function importsControlRouter(service: ImportSessionService) {
  const os = implementContract(importsControlContract);
  return os.router({
    execute: os.execute.handler(async ({ input }) => unwrapRpc(await executeImportOperation(service, input))),
  });
}

/** Register with the existing agent command bus; execute forwards over main's private control port. */
export function createImportCommands(execute: (operation: ImportOperation) => AsyncResult<unknown>) {
  return Object.values(C).map((name) =>
    defineCommand({
      name,
      payload: P[name],
      sideEffect: 'write',
      async handle(payload) {
        const result = await execute(importOperationSchema.parse({ name, payload }));
        return result.ok ? ok({ result: result.value }) : result;
      },
    }),
  );
}
