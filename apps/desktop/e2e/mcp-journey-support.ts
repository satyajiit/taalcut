// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Around mcp-journey.e2e.ts: a time limit for calls that have none of their own (page.evaluate, app.evaluate), and
 * a close that can't hang the worker (a close that doesn't finish is reported and the process killed).
 */
import type { ElectronApplication } from '@playwright/test';

/** `work`, or an error naming `label` once `ms` have passed without an answer. */
export async function within<T>(ms: number, label: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: no answer in ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** Closes the app; when that takes longer than `ms`, kills it and says so. */
export async function closeOrKill(app: ElectronApplication, ms: number): Promise<'closed' | 'killed'> {
  try {
    await within(ms, 'app.close()', app.close());
    return 'closed';
  } catch {
    app.process().kill('SIGKILL');
    return 'killed';
  }
}
