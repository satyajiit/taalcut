// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.updates (P2-X6). Settings → About: version, channel, status,
 * and installNow once an update is staged. Registers the host so
 * startAutoUpdate can feed it without index.ts changing.
 */
import { implementContract, updatesContract } from '@taalcut/core';
import { registerUpdateHost, type UpdateHost } from './host';
import { toWire, wireStream } from '../../shared/wire';

export { createUpdateHost, type UpdateHost, type UpdateHostOptions } from './host';

export function updatesRouter(host: UpdateHost) {
  registerUpdateHost(host);
  const os = implementContract(updatesContract);
  return os.router({
    state: os.state.handler(() => toWire(host.state())),
    changed: os.changed.handler(({ signal }) => wireStream(host.changed(signal))),
    check: os.check.handler(async () => toWire(await host.check())),
    installNow: os.installNow.handler(() => host.installNow()),
  });
}
