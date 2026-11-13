// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, newId, ok, ValidationError } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import type { BridgeSession } from '../../src/usb/bridge';
import { pullToPart } from '../../src/usb/pull';

describe('USB shared destination budget', () => {
  it('refuses a pull before touching the device when another import reserved its space', async () => {
    const pull = vi.fn();
    const reserve = vi.fn(async () => err(ValidationError({ field: 'space' })));
    const result = await pullToPart({
      session: { rangedReads: false, pull } as unknown as BridgeSession,
      itemId: 'file',
      partPath: join(tmpdir(), newId<'TransferUpload'>()),
      signal: new AbortController().signal,
      expectedBytes: 40,
      owner: 'usb',
      space: { reserve, consume: () => undefined, release: () => undefined },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'transfer.disk_full' } });
    expect(reserve).toHaveBeenCalledWith('usb', 40);
    expect(pull).not.toHaveBeenCalled();
  });
  it('consumes measured byte deltas and releases the remainder on completion', async () => {
    const consume = vi.fn();
    const release = vi.fn();
    const reserve = vi.fn(async () => ok(undefined));
    const session = {
      rangedReads: false,
      async pull(_id: string, options: { onBytes?: (bytes: number) => void }) {
        options.onBytes?.(10);
        options.onBytes?.(40);
        return ok({ bytes: 40, sha256: 'ab', ancillary: [] });
      },
    } as unknown as BridgeSession;
    const result = await pullToPart({
      session,
      itemId: 'file',
      partPath: join(tmpdir(), newId<'TransferUpload'>()),
      signal: new AbortController().signal,
      expectedBytes: 40,
      owner: 'usb',
      space: { reserve, consume, release },
    });
    expect(result.ok).toBe(true);
    expect(consume.mock.calls.reduce((sum, call) => sum + Number(call[1]), 0)).toBe(40);
    expect(release).toHaveBeenCalledWith('usb');
  });
});
