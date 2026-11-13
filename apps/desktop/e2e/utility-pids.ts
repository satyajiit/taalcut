// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The app's utility processes by service name ("Taalcut jobs", "Taalcut shot model"), from main's own process
 * list: what the durability, RPC, MCP, feedback and indexing e2e tests kill, ping or wait for.
 */
import type { ElectronApplication } from '@playwright/test';

/** pids of the utility processes named `serviceName`. */
export function utilityPids(app: ElectronApplication, serviceName: string): Promise<number[]> {
  return app.evaluate(
    ({ app: electronApp }, name) =>
      electronApp
        .getAppMetrics()
        .filter((metric) => metric.type === 'Utility' && metric.name === name)
        .map((metric) => metric.pid),
    serviceName,
  );
}

/** pid of the utility process named `serviceName`, if one runs. */
export async function servicePid(app: ElectronApplication, serviceName: string): Promise<number | undefined> {
  return (await utilityPids(app, serviceName))[0];
}

/** pid of `Taalcut <name>`, if it runs. */
export function utilityPid(
  app: ElectronApplication,
  name: 'agent' | 'jobs' | 'render',
): Promise<number | undefined> {
  return servicePid(app, `Taalcut ${name}`);
}
