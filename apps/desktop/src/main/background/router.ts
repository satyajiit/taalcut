// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  implementContract,
  productBackgroundContract,
  productBackgroundControlContract,
  unwrapRpc,
} from '@taalcut/core';
import type { ProductBackground } from './product-background';

export function productBackgroundRouter(background: Pick<ProductBackground, 'status'>) {
  const os = implementContract(productBackgroundContract);
  return os.router({ status: os.status.handler(async () => unwrapRpc(await background.status())) });
}

/** This router is served only on the agent utility's main-service port, never to renderer clients. */
export function productBackgroundControlRouter(get: () => Pick<ProductBackground, 'status' | 'setEnabled'>) {
  const os = implementContract(productBackgroundControlContract);
  return os.router({
    status: os.status.handler(async () => unwrapRpc(await get().status())),
    setEnabled: os.setEnabled.handler(async ({ input }) => unwrapRpc(await get().setEnabled(input.enabled))),
  });
}
