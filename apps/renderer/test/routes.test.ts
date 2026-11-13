// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createMemoryHistory } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../e2e/routes';
import { createAppRouter } from '../src/router';

// PRD 9.3, plus the routes later work packages need (P1-H5, P1-G5).
const REQUIRED = [
  '/onboarding',
  '/onboarding/$step',
  '/chat',
  '/chat/$conversationId',
  '/library',
  '/library/$assetId',
  '/library/phone',
  '/templates',
  '/templates/$templateId',
  '/projects/$projectId/timeline',
  '/renders',
  '/settings/models',
  '/settings/sources',
  '/settings/privacy',
  '/settings/memory',
  '/settings/usage',
  '/settings/accounts',
  '/settings/plugins',
  '/settings/plugins/$pluginId',
  '/settings/about',
  '/dev/traces',
];

const router = createAppRouter(createMemoryHistory());
const leaves = Object.values(router.routesById).filter((route) => !route.children);
const trimmed = (path: string) => (path.length > 1 ? path.replace(/\/$/, '') : path);

describe('route table', () => {
  it('has a typed route for every path in PRD 9.3', () => {
    const paths = new Set(leaves.map((route) => trimmed(route.fullPath)));
    for (const path of REQUIRED) expect(paths, path).toContain(path);
  });

  it('gives every route a sample URL, so the end-to-end checks visit it', () => {
    for (const route of leaves) {
      const covered = ROUTES.some((sample) => {
        const [, , found] = router.getMatchedRoutes(new URL(sample.path, 'http://x').pathname);
        return found?.id === route.id;
      });
      expect(covered, `no sample URL in e2e/routes.ts reaches ${route.id}`).toBe(true);
    }
  });
});
