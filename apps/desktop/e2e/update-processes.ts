// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

/** Only profiles launched by this test worker may own guards that its cleanup stops. */
const profiles = new Set<string>();
const guards = new Map<number, string>();

export function trackGuardProfile(userData: string): void {
  profiles.add(resolve(userData));
}

function discoverGuard(profile: string): void {
  const binary = join(profile, 'updates', 'guard', 'taalcut');
  for (const [pid, previous] of guards) if (previous === binary) guards.delete(pid);
  const rows = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n');
  for (const row of rows) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(row);
    if (match && (match[2] === binary || match[2]?.startsWith(`${binary} `))) {
      guards.set(Number(match[1]), binary);
    }
  }
}

/** Records the PID of the guard the test app started in its exact, unique profile. */
export function guardRunning(userData: string): boolean {
  const profile = resolve(userData);
  if (!profiles.has(profile)) throw new Error(`untracked update profile: ${profile}`);
  discoverGuard(profile);
  return [...guards.values()].includes(join(profile, 'updates', 'guard', 'taalcut'));
}

/** Stops only recorded child guards from this worker; verify each PID again to avoid PID reuse. */
export function stopGuards(dir: string): void {
  const root = resolve(dir);
  for (const profile of profiles) {
    if (profile === root || profile.startsWith(root + sep)) discoverGuard(profile);
  }
  for (const [pid, binary] of guards) {
    if (!binary.startsWith(root + sep)) continue;
    try {
      const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
      if (command === binary || command.startsWith(`${binary} `)) process.kill(pid, 'SIGTERM');
    } catch {
      // This exact child already exited.
    }
    guards.delete(pid);
  }
}

/** Keep the native installer evidence in the failure before afterAll clears its shared cache. */
export function shipItDiagnostics(): string {
  const cache = join(homedir(), 'Library', 'Caches', 'com.taalcut.app.ShipIt');
  return ['ShipIt_stderr.log', 'ShipIt_stdout.log']
    .map((name) => {
      const file = join(cache, name);
      return `${name}:\n${existsSync(file) ? readFileSync(file, 'utf8').slice(-12_000) : '(none)'}`;
    })
    .join('\n');
}
