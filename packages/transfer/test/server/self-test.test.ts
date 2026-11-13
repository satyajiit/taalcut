// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// A self-test refused at once means macOS's Local Network switch only where the OS has one (UX3-MAC); on Linux and
// Windows it is a firewall, and the window says so instead of pointing at a setting that isn't there.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:http', () => ({
  request: () => {
    const req = Object.assign(new EventEmitter(), { end: () => undefined, destroy: () => undefined });
    queueMicrotask(() => req.emit('error', Object.assign(new Error('refused'), { code: 'EPERM' })));
    return req;
  },
}));

const { selfTestPing } = await import('../../src/http/self-test');

describe('a self-test refused at once', () => {
  it('is the Local Network switch where the OS has one, as on a Mac (the default)', async () => {
    await expect(selfTestPing('192.168.1.20', 4242, 100)).resolves.toBe('local-network-denied');
  });

  it('is a firewall where it has none', async () => {
    await expect(selfTestPing('192.168.1.20', 4242, 100, false)).resolves.toBe('blocked');
  });
});
