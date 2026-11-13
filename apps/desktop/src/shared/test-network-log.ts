// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test builds only (TAALCUT_BUILD_FLAVOUR=test): the network recorder (@taalcut/models/node,
 * P3-B10) in this process, for the Local only journey's "zero outbound connections". Main and every utility
 * process reach this module only inside `__TAALCUT_FLAVOUR__ === 'test'` through import(), so release bundles
 * don't contain it.
 *
 *   TAALCUT_TEST_NETWORK_LOG=<dir>   record every outbound attempt of this process (refusing all but loopback)
 *                                    into <dir>/<process>.jsonl: first an `installed` line, then one line per
 *                                    attempt (api, host, port, allowed, stack)
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { testEnvDir } from './test-env-dir';

export const NETWORK_LOG_ENV = 'TAALCUT_TEST_NETWORK_LOG';

/** One line of a process's log. */
export type NetworkLogLine =
  | { readonly kind: 'installed'; readonly process: string; readonly pid: number; readonly at: number }
  | {
      readonly kind: 'attempt';
      readonly process: string;
      readonly api: string;
      readonly host: string;
      readonly port: number | null;
      readonly allowed: boolean;
      readonly at: number;
      readonly stack: string;
    };

/** The folder the variable names, or undefined when it isn't set. Throws when it isn't an absolute path. */
export function networkLogDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  return testEnvDir(NETWORK_LOG_ENV, env);
}

export function appendNetworkLog(dir: string, line: NetworkLogLine): void {
  appendFileSync(join(dir, `${line.process}.jsonl`), `${JSON.stringify(line)}\n`);
}

/**
 * Installs the recorder for this process when the variable is set (allowing loopback only). Resolves once
 * installed, so the caller can hold its first network use until then.
 */
export async function installNetworkLog(processName: string): Promise<void> {
  const dir = networkLogDir();
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const { recordNetwork } = await import('@taalcut/models/node');
  recordNetwork({
    onAttempt: (attempt) =>
      appendNetworkLog(dir, {
        kind: 'attempt',
        process: processName,
        api: attempt.api,
        host: attempt.host,
        port: attempt.port,
        allowed: attempt.allowed,
        at: attempt.at,
        stack: attempt.stack,
      }),
  });
  appendNetworkLog(dir, { kind: 'installed', process: processName, pid: process.pid, at: Date.now() });
}
