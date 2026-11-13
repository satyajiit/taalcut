// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_SERVICE,
  backgroundUnits,
  createNativeRegistration,
  systemdArgument,
} from '../src/main/background/native-registration';

const temp: string[] = [];
afterEach(async () => {
  await Promise.all(temp.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const loginItems = () => ({
  setLoginItemSettings: vi.fn(),
  getLoginItemSettings: vi.fn(() => ({ status: 'enabled' })),
});

describe('native background registration', () => {
  it('uses Electron SMAppService agent registration and exposes approval state', async () => {
    const login = loginItems();
    login.getLoginItemSettings.mockReturnValue({ status: 'requires-approval' });
    const native = createNativeRegistration({
      platform: 'darwin',
      packaged: true,
      executable: '/Applications/Taalcut.app/Contents/MacOS/Taalcut',
      userData: '/profile',
      loginItems: login,
    });
    expect(await native.setEnabled(true)).toEqual({ ok: true, value: 'requires-approval' });
    expect(login.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      type: 'agentService',
      serviceName: BACKGROUND_SERVICE,
    });
    await native.setEnabled(false);
    expect(login.setLoginItemSettings).toHaveBeenLastCalledWith({
      openAtLogin: false,
      type: 'agentService',
      serviceName: BACKGROUND_SERVICE,
    });
  });
  it('never registers unpackaged development apps on the real machine', async () => {
    const login = loginItems();
    const native = createNativeRegistration({
      platform: 'darwin',
      packaged: false,
      executable: '/dev/electron',
      userData: '/profile',
      loginItems: login,
    });
    expect(await native.setEnabled(true)).toEqual({ ok: true, value: 'unsupported' });
    expect(login.setLoginItemSettings).not.toHaveBeenCalled();
  });
  it('writes one persistent user timer and does not kill the GUI when disabling', async () => {
    const configHome = await mkdtemp(join(tmpdir(), 'taalcut-background-'));
    temp.push(configHome);
    const run = vi.fn(async (args: readonly string[]) => (args[0] === 'is-enabled' ? 'enabled' : ''));
    const native = createNativeRegistration({
      platform: 'linux',
      packaged: true,
      executable: '/opt/Taalcut/bin/app',
      userData: '/home/person/My profile',
      configHome,
      run,
      loginItems: loginItems(),
    });
    expect((await native.setEnabled(true)).ok).toBe(true);
    const service = await readFile(join(configHome, 'systemd/user/taalcut-background.service'), 'utf8');
    const timer = await readFile(join(configHome, 'systemd/user/taalcut-background.timer'), 'utf8');
    expect(service).toContain(
      'ExecStart="/opt/Taalcut/bin/app" --taalcut-background "--user-data-dir=/home/person/My profile"',
    );
    expect(timer).toContain('Persistent=true');
    expect(run).toHaveBeenCalledWith(['enable', '--now', 'taalcut-background.timer']);
    await native.setEnabled(false);
    expect(run).toHaveBeenCalledWith(['disable', '--now', 'taalcut-background.timer']);
    expect(
      run.mock.calls.some(([args]) => args.includes('taalcut-background.service') && args.includes('stop')),
    ).toBe(false);
  });
  it('quotes systemd arguments without shell, environment, or specifier expansion', () => {
    expect(systemdArgument('/apps/A $USER %h "quoted"')).toBe('"/apps/A $$USER %%h \\"quoted\\""');
    expect(() => backgroundUnits('/app\nExecStart=/evil', '/profile')).toThrow();
  });
  it('reports failed OS registration instead of claiming enabled', async () => {
    const native = createNativeRegistration({
      platform: 'linux',
      packaged: true,
      executable: '/app',
      userData: '/profile',
      run: async () => {
        throw new Error('No user bus');
      },
      loginItems: loginItems(),
    });
    expect((await native.status()).ok).toBe(false);
  });
});
