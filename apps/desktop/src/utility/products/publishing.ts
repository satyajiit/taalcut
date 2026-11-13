// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  CommandBusToken,
  defineCommand,
  err,
  idSchema,
  NotFoundError,
  ok,
  PERSON_SOURCES,
  PluginAgentServiceToken,
  PRODUCT_PUBLISH_COMMANDS as names,
  productPublishCommandPayloads as payloads,
  productPublishingRouter,
  type AnyCommand,
  type Container,
  type ProductStore,
  type ProductPublishId,
  type ProductPublishRecord,
  type AsyncResult,
  type Result,
} from '@taalcut/core';
import { createProductPublishStore, LibraryDatabaseToken } from '@taalcut/library';
import { z } from 'zod';
import { productPublishingRecovery } from './publishing-recovery';
import { createProductPublisher } from '@taalcut/tools';
import { productPublishMedia } from './publishing-media';
import { productPublishingMetadata } from './publishing-metadata';
import { productPublishingActivity } from './publishing-activity';

const outcome = <T>(result: Result<T>) => (result.ok ? ok({ result: result.value }) : result);

/** All external work uses the existing main-process plugin boundary; credentials never enter this process. */
export function composeProductPublishing(container: Container, products: ProductStore) {
  const media = productPublishMedia(container, products);
  const store = createProductPublishStore(container.resolve(LibraryDatabaseToken));
  const publisher = createProductPublisher({
    store,
    plugins: {
      invoke: (request) =>
        container.has(PluginAgentServiceToken)
          ? container.resolve(PluginAgentServiceToken).invoke(request)
          : Promise.resolve(err(NotFoundError({ entity: 'postiz' }))),
    },
    campaignRevision: async (id) => {
      const campaign = await products.getCampaign(id);
      return campaign.ok ? ok(campaign.value.revision) : campaign;
    },
    verifyRender: media.verifyRender,
  });
  const prepareMetadata = productPublishingMetadata(products, publisher, media);
  const activity = productPublishingActivity(products, publisher);
  async function transition(id: ProductPublishId, action: () => AsyncResult<ProductPublishRecord>) {
    const before = await publisher.get(id);
    const result = await action();
    if (result.ok) await activity(before.ok ? before.value : null, result.value);
    return outcome(result);
  }
  const checkpoint = 'product.publish.advanceCursor';
  const commands: AnyCommand[] = [
    defineCommand({
      name: checkpoint,
      payload: z.object({ id: idSchema<'ProductPublish'>().nullable() }),
      sideEffect: 'write',
      internal: true,
      handle: async ({ id }) => outcome(await store.saveReconcileCursor(id)),
    }),
    defineCommand({
      name: names.prepare,
      payload: payloads[names.prepare],
      sideEffect: 'write',
      handle: async (input) => {
        const result = await publisher.prepare(input.drafts);
        if (result.ok) for (const record of result.value) await activity(null, record);
        return outcome(result);
      },
    }),
    defineCommand({
      name: names.approve,
      payload: payloads[names.approve],
      sideEffect: 'write',
      sources: PERSON_SOURCES,
      handle: (input) => transition(input.id, () => publisher.approve(input.id, input.expectedRevision)),
    }),
    defineCommand({
      name: names.dispatch,
      payload: payloads[names.dispatch],
      sideEffect: 'external',
      handle: (input) => transition(input.id, () => publisher.dispatch(input.id)),
    }),
    defineCommand({
      name: names.reconcile,
      payload: payloads[names.reconcile],
      sideEffect: 'external',
      handle: (input) => transition(input.id, () => publisher.reconcile(input.id)),
    }),
    defineCommand({
      name: names.cancel,
      payload: payloads[names.cancel],
      sideEffect: 'write',
      handle: (input) => transition(input.id, () => publisher.cancel(input.id, input.expectedRevision)),
    }),
  ];
  const origin = { source: 'agent', actor: 'product-publishing' } as const;
  const wake = productPublishingRecovery({
    store,
    dispatch: (record) =>
      container
        .resolve(CommandBusToken)
        .dispatch(record.status === 'approved' ? names.dispatch : names.reconcile, { id: record.id }, origin),
    checkpoint: (id) => container.resolve(CommandBusToken).dispatch(checkpoint, { id }, origin),
  });
  const service = {
    ...publisher,
    prepareMetadata,
    wake,
    startReconcile() {
      void wake();
      const timer = setInterval(() => {
        void wake();
      }, 60_000);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
  return { commands, router: productPublishingRouter(service), service };
}
