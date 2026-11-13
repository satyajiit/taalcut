// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The lan process: diagnostics, events, and the transfer service.
 * Listening starts when transfer.open runs; compose does not bind a port.
 */
import { join } from 'node:path';
import {
  ClockToken,
  EventBusToken,
  implementContract,
  ImportSinkToken,
  UTILITY_CONTRACTS,
  type Container,
  type PortLike,
} from '@taalcut/core';
import {
  createTransferService,
  nodeNetworkInfo,
  phoneAssetsFromDir,
  transferRouter,
} from '@taalcut/transfer';
import { PlatformServicesToken } from '../../platform';
import { type UtilityConfig } from '../../shared/rpc-ipc';
import { type UtilityRoot } from '../runtime';
import { transferPhoneDir } from '../transfer-phone';
import { commonRouters, createUtilityContainer } from './base';
import { lanMedia } from './lan-media';
import { libraryImportSink } from './library-lan';
import { registerLanDevices } from './lan-devices';

/** Keeps the service reachable for as long as the process container is. UtilityRoot has no field for it. */
const retain = new WeakMap<Container, unknown>();

export function composeLan(
  config: UtilityConfig,
  mainOrPid?: PortLike | number,
  pid = process.pid,
): UtilityRoot {
  const numbered = typeof mainOrPid === 'number';
  const main = numbered ? undefined : mainOrPid;
  const processPid = numbered ? mainOrPid : pid;
  const container = createUtilityContainer(config);
  const { abilities, words } = container.resolve(PlatformServicesToken);
  // The library's sink: hashes, de-duplicates and files each upload into the originals root (P2-L3).
  const sink = libraryImportSink(container);
  container.value(ImportSinkToken, sink);
  const clock = container.resolve(ClockToken);
  const bus = container.resolve(EventBusToken);
  const stateDir = join(config.userData, 'transfer');
  const media = lanMedia(config);
  const service = createTransferService({
    keepReceptionOpen: true,
    importSink: sink,
    media,
    events: bus,
    clock,
    stateDir,
    // "Your Mac" on a Mac, "your computer" elsewhere (the page's own words, served from here).
    phoneAssets: phoneAssetsFromDir(transferPhoneDir(), words === 'mac' ? 'mac' : 'computer'),
    network: nodeNetworkInfo(),
    // Only macOS has a Local Network switch for a refused self-test to mean; elsewhere it is a firewall.
    localNetworkPrivacy: abilities.localNetworkPrivacy,
    log: { info() {} },
  });
  // One slot: the Wi-Fi service, the device facade, and the real service once `usb` has loaded.
  const held: unknown[] = [service];
  retain.set(container, held);
  const devices = registerLanDevices({
    container,
    config,
    main,
    importSink: sink,
    media,
    events: bus,
    clock,
    retain: (usb) => {
      held.push(usb);
    },
    cableImport: abilities.cableImport,
  });
  held.push(devices);
  const os = implementContract(UTILITY_CONTRACTS.lan);
  return {
    container,
    router: os.router({
      ...commonRouters(container, 'lan', processPid),
      transfer: transferRouter(service, devices),
    }),
    // On SIGTERM, before the container goes: USB runs stop and their last save lands, so no save comes after
    // this process (main starts the next lan process only once this one has exited).
    stop: () => devices.close(),
  };
}
