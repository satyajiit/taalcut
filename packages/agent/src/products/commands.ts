// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  defineCommand,
  ok,
  PRODUCT_COMMANDS as C,
  productCommandPayloads as P,
  type AnyCommand,
} from '@taalcut/core';
import type { ProductOperations } from './service';

export function createProductCommands(service: ProductOperations): AnyCommand[] {
  return [
    defineCommand({
      name: C.create,
      payload: P[C.create],
      sideEffect: 'write',
      async handle(input, ctx) {
        const made = await service.create(input.product, input.productId, ctx);
        return made.ok
          ? ok({
              result: made.value,
              replayPayload: { ...input, productId: made.value.id },
              inverse: {
                name: C.archive,
                payload: { productId: made.value.id, revision: made.value.revision, archived: true },
              },
            })
          : made;
      },
    }),
    defineCommand({
      name: C.update,
      payload: P[C.update],
      sideEffect: 'write',
      async handle(input, ctx) {
        const before = await service.get({ productId: input.productId });
        if (!before.ok) return before;
        const saved = await service.update(input.productId, input.revision, input.product, ctx);
        return saved.ok
          ? ok({
              result: saved.value,
              inverse: {
                name: C.update,
                payload: {
                  productId: input.productId,
                  revision: saved.value.revision,
                  product: before.value,
                },
              },
            })
          : saved;
      },
    }),
    defineCommand({
      name: C.archive,
      payload: P[C.archive],
      sideEffect: 'write',
      async handle(input, ctx) {
        const before = await service.get({ productId: input.productId });
        if (!before.ok) return before;
        const saved = await service.archive(input.productId, input.revision, input.archived, ctx);
        return saved.ok
          ? ok({
              result: saved.value,
              inverse: {
                name: C.archive,
                payload: {
                  productId: input.productId,
                  revision: saved.value.revision,
                  archived: before.value.archivedAt !== null,
                },
              },
            })
          : saved;
      },
    }),
    defineCommand({
      name: C.research,
      payload: P[C.research],
      sideEffect: 'write',
      async handle({ productId }) {
        const result = await service.research(productId);
        return result.ok ? ok({ result: result.value }) : result;
      },
    }),
    defineCommand({
      name: C.choose,
      payload: P[C.choose],
      sideEffect: 'write',
      async handle({ productId, ideaId }) {
        const result = await service.choose(productId, ideaId);
        return result.ok ? ok({ result: result.value }) : result;
      },
    }),
    defineCommand({
      name: C.reject,
      payload: P[C.reject],
      sideEffect: 'write',
      async handle(input, ctx) {
        const result = await service.reject(input.productId, input.ideaId, input.feedback, ctx);
        return result.ok ? ok({ result: null }) : result;
      },
    }),
    defineCommand({
      name: C.schedule,
      payload: P[C.schedule],
      sideEffect: 'write',
      async handle({ schedule }, ctx) {
        const result = await service.setSchedule(schedule, ctx);
        return result.ok ? ok({ result: null }) : result;
      },
    }),
    defineCommand({
      name: C.readNotification,
      payload: P[C.readNotification],
      sideEffect: 'write',
      async handle({ id }, ctx) {
        const result = await service.readNotification(id, ctx);
        return result.ok ? ok({ result: null }) : result;
      },
    }),
  ];
}
