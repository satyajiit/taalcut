// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The render process until its work package lands: diagnostics and an event
 * bus. `renders` and `worker` (P2-M6, P2-M11) answer core.not_implemented
 * until @taalcut/render's routers replace them. The LAN process is
 * composeLan (transferRouter).
 */
import {
  implementContract,
  notServedRouter,
  rendersContract,
  renderWorkerContract,
  UTILITY_CONTRACTS,
} from '@taalcut/core';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import type { UtilityRoot } from '../runtime';
import { commonRouters, createUtilityContainer } from './base';
import { composeLan } from './lan-root';

export function composeStub(config: UtilityConfig, pid: number = process.pid): UtilityRoot {
  if (config.process === 'lan') return composeLan(config, pid);
  const container = createUtilityContainer(config);
  // The render graph registers here: rendersRouter and renderWorkerRouter from @taalcut/render.
  const os = implementContract(UTILITY_CONTRACTS.render);
  const router = os.router({
    ...commonRouters(container, 'render', pid),
    renders: notServedRouter(rendersContract, 'renders'),
    worker: notServedRouter(renderWorkerContract, 'render.worker'),
  });
  return { container, router };
}
