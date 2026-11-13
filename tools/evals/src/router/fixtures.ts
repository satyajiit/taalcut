// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { writeJson } from '../files';
import { shadowLog, type ShadowDecision } from '../adapters/router';
import type { RouterLabel } from './schema';

export const ROUTER_CASE_ID = 'shadow';
export const ROUTER_DECISIONS = 200;

/** 200 agreeing `timeline` decisions and a golden set at a 30% token drop, all synthetic. */
export function routerFixture(): { label: RouterLabel; decisions: ShadowDecision[] } {
  const tasks = Array.from({ length: 10 }, (_, index) => `task-${index}`);
  const label: RouterLabel = {
    caseId: ROUTER_CASE_ID,
    synthetic: true,
    off: tasks.map((taskId) => ({ taskId, promptTokens: 100, passed: true })),
    on: tasks.map((taskId) => ({ taskId, promptTokens: 70, passed: true, routerInputTokens: 15 })),
  };
  const decisions = Array.from({ length: ROUTER_DECISIONS }, () => ({
    choice: 'timeline',
    main: 'timeline',
  }));
  return { label, decisions };
}

export function writeRouterFixtures(dir: string): { labels: string } {
  const fixture = routerFixture();
  writeJson(join(dir, 'golden.json'), fixture.label);
  writeJson(join(dir, 'logs', 'run.json'), shadowLog(fixture.decisions));
  return { labels: dir };
}
