// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The shot-boundary model's process in Electron (IX2-S2, shot-model-host.ts): out/utility/shot-model.mjs forked
 * as a utility process (the RunAsNode fuse is off, so not a Node child), its stderr kept for the debug bundle,
 * and a MessageChannelMain between it and the jobs process.
 */
import { join } from 'node:path';
import { MessageChannelMain, utilityProcess, type MessagePortMain } from 'electron';
import { SHOT_MODEL_SERVICE } from '../../shared/shot-model-ipc';
import { withAcceleratorEnv } from '../../utility/accelerator-env';
import { managedNativesOnly } from '../../utility/roots/dev-components';
import { attachUtilityStderr } from '../debug/log-ring';
import { shotModelHost, type ShotModelHost } from './shot-model-host';

export interface ShotModelOptions {
  /** out/utility. */
  readonly utilityDir: string;
  readonly userData: string;
  readonly packaged: boolean;
}

export function electronShotModelHost(options: ShotModelOptions): ShotModelHost<MessagePortMain> {
  return shotModelHost({
    fork: () => {
      const child = utilityProcess.fork(join(options.utilityDir, 'shot-model.mjs'), [], {
        serviceName: SHOT_MODEL_SERVICE,
        stdio: 'pipe',
        ...withAcceleratorEnv({}, join(options.userData, 'components'), {
          managedOnly: managedNativesOnly(options.packaged),
        }),
      });
      attachUtilityStderr('shot-model', child.stderr);
      return child;
    },
    createChannel: () => {
      const { port1, port2 } = new MessageChannelMain();
      return { model: port1, client: port2 };
    },
    connect: { componentsRoot: join(options.userData, 'components'), packaged: options.packaged },
    allowed: ['jobs'],
  });
}
