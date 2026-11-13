// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { defineError, err, ok, type AsyncResult } from '@taalcut/core';

export const BACKGROUND_SERVICE = 'com.taalcut.app.background.plist';
export const BACKGROUND_SWITCH = 'taalcut-background';
export const BACKGROUND_UNIT = 'taalcut-background';
export type RegistrationState = 'enabled' | 'requires-approval' | 'not-registered' | 'unsupported' | 'failed';
export interface NativeRegistration {
  status(): AsyncResult<RegistrationState>;
  setEnabled(enabled: boolean): AsyncResult<RegistrationState>;
}
export interface LoginItems {
  setLoginItemSettings(settings: { openAtLogin: boolean; type: 'agentService'; serviceName: string }): void;
  getLoginItemSettings(settings: { type: 'agentService'; serviceName: string }): { status: string };
}
export const BackgroundRegistrationFailed = defineError('desktop.background_registration_failed', {
  retryable: true,
});

/** systemd parses ExecStart itself. Quotes, percent specifiers and control characters must not become syntax. */
export function systemdArgument(value: string): string {
  if ([...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    throw new Error('Invalid systemd argument');
  return `"${value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('%', '%%')
    .replaceAll('$', () => '$$')}"`;
}

export function backgroundUnits(executable: string, userData: string): { service: string; timer: string } {
  return {
    service: `[Unit]\nDescription=Taalcut background work\nAfter=graphical-session.target\n\n[Service]\nType=simple\nExecStart=${systemdArgument(executable)} --${BACKGROUND_SWITCH} ${systemdArgument(`--user-data-dir=${userData}`)}\nRestart=no\n`,
    timer: `[Unit]\nDescription=Wake Taalcut schedules\n\n[Timer]\nOnCalendar=*-*-* *:*:00\nPersistent=true\nAccuracySec=1s\nUnit=${BACKGROUND_UNIT}.service\n\n[Install]\nWantedBy=timers.target\n`,
  };
}

export interface RegistrationOptions {
  readonly platform: string;
  readonly packaged: boolean;
  readonly executable: string;
  readonly userData: string;
  readonly loginItems: LoginItems;
  readonly configHome?: string;
  readonly run?: (args: readonly string[]) => Promise<string>;
}

export function createNativeRegistration(options: RegistrationOptions): NativeRegistration {
  const run =
    options.run ??
    (async (args) => {
      try {
        const result = await promisify(execFile)('systemctl', ['--user', ...args], { timeout: 10_000 });
        return result.stdout.trim();
      } catch (cause) {
        const output =
          typeof cause === 'object' && cause !== null && 'stdout' in cause ? String(cause.stdout).trim() : '';
        if (args[0] === 'is-enabled' && ['disabled', 'not-found', 'static', 'masked'].includes(output))
          return output;
        throw cause;
      }
    });
  const configHome =
    options.configHome ??
    (process.env.XDG_CONFIG_HOME && isAbsolute(process.env.XDG_CONFIG_HOME)
      ? process.env.XDG_CONFIG_HOME
      : join(homedir(), '.config'));
  const dir = join(configHome, 'systemd', 'user');
  const macOptions = { type: 'agentService', serviceName: BACKGROUND_SERVICE } as const;
  const supported = options.packaged && ['darwin', 'linux'].includes(options.platform);

  async function status(): AsyncResult<RegistrationState> {
    if (!supported) return ok('unsupported');
    try {
      if (options.platform === 'darwin') {
        const value = options.loginItems.getLoginItemSettings(macOptions).status;
        return ok(value === 'enabled' || value === 'requires-approval' ? value : 'not-registered');
      }
      return ok(
        (await run(['is-enabled', `${BACKGROUND_UNIT}.timer`])) === 'enabled' ? 'enabled' : 'not-registered',
      );
    } catch {
      return err(BackgroundRegistrationFailed({}));
    }
  }

  return {
    status,
    async setEnabled(enabled) {
      if (!supported) return ok('unsupported');
      try {
        if (options.platform === 'darwin') {
          options.loginItems.setLoginItemSettings({ ...macOptions, openAtLogin: enabled });
        } else if (enabled) {
          const units = backgroundUnits(options.executable, options.userData);
          await mkdir(dir, { recursive: true, mode: 0o700 });
          await writeFile(join(dir, `${BACKGROUND_UNIT}.service`), units.service, { mode: 0o600 });
          await writeFile(join(dir, `${BACKGROUND_UNIT}.timer`), units.timer, { mode: 0o600 });
          await run(['daemon-reload']);
          await run(['enable', '--now', `${BACKGROUND_UNIT}.timer`]);
        } else {
          await run(['disable', '--now', `${BACKGROUND_UNIT}.timer`]);
          // Do not stop the service: it may own this same app while the person is editing in its window.
          await rm(join(dir, `${BACKGROUND_UNIT}.timer`), { force: true });
          await rm(join(dir, `${BACKGROUND_UNIT}.service`), { force: true });
          await run(['daemon-reload']);
        }
        return status();
      } catch {
        return err(BackgroundRegistrationFailed({}));
      }
    },
  };
}
