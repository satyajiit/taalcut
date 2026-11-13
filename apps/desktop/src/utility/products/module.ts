// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  CommandBusToken,
  createToken,
  defineCommand,
  err,
  EventBusToken,
  implementContract,
  NotFoundError,
  newId,
  ok,
  PERSON_SOURCES,
  PRODUCT_COMMANDS as names,
  productCommandPayloads as payloads,
  productRouter,
  productWakeContract,
  unwrapRpc,
  type Container,
} from '@taalcut/core';
import { createProductCommands, createProductService } from '@taalcut/agent';
import { createProductStore } from '@taalcut/library';
import { createProductScheduler, nextScheduleOccurrence } from '@taalcut/jobs';
import { AgentMainServicesToken, LibraryDatabaseToken, LibraryPortsToken } from '../../shared/tokens';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { createProductCreation } from './creation';
import { productProduction } from './production';
import { productResearchModel } from './model';
import { composeProductPublishing } from './publishing';
import { productSources } from './sources';
import { ProductServiceToken, ProductStoreToken } from './tokens';
import { followMainRenderEvents } from '../roots/agent-memory-exports';

const ReconcileStopToken = createToken<() => void>('desktop.productReconcileStop');

/** Shares the existing agent owner, database and model gateway. No second jobs engine or hosted coordinator. */
export function registerProducts(container: Container, config: UtilityConfig) {
  const store = createProductStore(container.resolve(LibraryDatabaseToken), {
    commands: container.resolve(LibraryPortsToken).commands,
  });
  container.value(ProductStoreToken, store);
  const service = createProductService({
    store,
    sources: productSources(container, config),
    model: productResearchModel(container),
    creation: createProductCreation(container, store),
    nextSchedule: nextScheduleOccurrence,
  });
  container.value(ProductServiceToken, service);
  const production = productProduction(container, store, service);
  const publishing = composeProductPublishing(container, store);
  const scheduler = createProductScheduler({
    store,
    async execute(occurrence, signal) {
      const result = await service.runScheduled(occurrence.productId, signal, occurrence.id);
      if (!result.ok && !signal.aborted) {
        const product = await store.get(occurrence.productId);
        if (product.ok)
          await store.appendNotification({
            id: newId<'ProductNotification'>(),
            productId: occurrence.productId,
            campaignId: null,
            kind: 'failed',
            title: product.value.name,
            body: result.error.code,
            createdAt: Date.now(),
            readAt: null,
          });
      }
      container
        .resolve(EventBusToken)
        .emit('library.changed', {
          projectId: null,
          entity: 'project',
          change: 'updated',
          ids: [occurrence.productId],
        });
      return result.ok ? ok(undefined) : result;
    },
  });
  const commands = [
    ...createProductCommands(service),
    ...publishing.commands,
    ...production.commands,
    defineCommand({
      name: names.wake,
      payload: payloads[names.wake],
      internal: true,
      sideEffect: 'write',
      handle: () => ok({ result: null }),
    }),
    defineCommand({
      name: names.setBackground,
      payload: payloads[names.setBackground],
      sideEffect: 'write',
      sources: PERSON_SOURCES,
      async handle(input) {
        if (!container.has(AgentMainServicesToken))
          return err(NotFoundError({ entity: 'backgroundService' }));
        const changed = await callRpc(
          container.resolve(AgentMainServicesToken)().productBackground.setEnabled(input),
        );
        return changed.ok ? ok({ result: changed.value }) : changed;
      },
    }),
  ];
  const os = implementContract(productWakeContract);
  return {
    commands,
    router: productRouter(service),
    publishing: publishing.router,
    wakeRouter: os.router({
      wake: os.wake.handler(async () => {
        const result = await container.resolve(CommandBusToken).dispatch(
          names.wake,
          {},
          {
            source: 'agent',
            actor: 'product-scheduler',
          },
        );
        unwrapRpc(result);
        await publishing.service.wake();
        const completed = unwrapRpc(await scheduler.wake());
        await production.start();
        return { completed };
      }),
    }),
    async start() {
      await production.start();
      container.factory(
        ReconcileStopToken,
        () => {
          const stop = publishing.service.startReconcile();
          const follower = container.has(AgentMainServicesToken)
            ? followMainRenderEvents(container.resolve(AgentMainServicesToken), ({ projectId }) =>
                production.follow(projectId),
              )
            : undefined;
          const timer = setInterval(() => {
            void production.wake();
          }, 60_000);
          timer.unref();
          return () => {
            stop();
            follower?.stop();
            clearInterval(timer);
            production.dispose();
          };
        },
        { dispose: (stop) => stop() },
      );
      container.resolve(ReconcileStopToken);
    },
  };
}
