// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * On SIGTERM the lan root's stop closes the USB runs (transfer SPEC, "Crash or quit") before the container goes:
 * the device facade closes the real service when one was made, and closing never makes one.
 */
import { describe, expect, it, vi } from 'vitest';
import { createManualClock, ok, type Container, type ImportSink } from '@taalcut/core';
import type * as transfer from '@taalcut/transfer';
import type { DeviceService, TransferMedia } from '@taalcut/transfer';
import type { UtilityConfig } from '../src/shared/rpc-ipc';
import { registerLanDevices } from '../src/utility/roots/lan-devices';

const real = vi.hoisted(() => ({ made: 0, closed: 0 }));

vi.mock('usb', () => ({}));
vi.mock('@taalcut/transfer', async (importOriginal) => {
  const actual = await importOriginal<typeof transfer>();
  return {
    ...actual,
    createDeviceService: (): Partial<DeviceService> => {
      real.made += 1;
      return {
        forgetUsbDebugKey: async () => ok({ forgotten: false }),
        close: async () => {
          real.closed += 1;
        },
      };
    },
  };
});

function facade(cableImport = true): DeviceService {
  return registerLanDevices({
    container: { value: () => undefined } as unknown as Container,
    config: { userData: '/tmp/taalcut-lan-close' } as UtilityConfig,
    main: undefined,
    importSink: {} as ImportSink,
    media: {} as TransferMedia,
    events: { emit: () => undefined },
    clock: createManualClock(0),
    retain: () => undefined,
    cableImport,
  });
}

describe('the lan device facade on stop', () => {
  it('closes the real service once a call has made it', async () => {
    real.made = 0;
    real.closed = 0;
    const devices = facade();
    expect((await devices.forgetUsbDebugKey()).ok).toBe(true);
    await devices.close();
    expect([real.made, real.closed]).toEqual([1, 1]);
  });

  it('makes no service just to close it', async () => {
    real.made = 0;
    real.closed = 0;
    await facade().close();
    expect([real.made, real.closed]).toEqual([0, 0]);
  });
});

describe('the lan device facade off a Mac (UX3-MAC)', () => {
  it('builds no bridge and answers that a cable isn’t here yet', async () => {
    real.made = 0;
    real.closed = 0;
    const devices = facade(false);
    const forgotten = await devices.forgetUsbDebugKey();
    expect(forgotten.ok ? undefined : forgotten.error.code).toBe('desktop.cable_unsupported');
    await expect(
      devices.devices(new AbortController().signal)[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({
      code: 'desktop.cable_unsupported',
    });
    await devices.close();
    expect([real.made, real.closed]).toEqual([0, 0]);
  });
});
