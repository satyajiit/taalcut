// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-CTX: the window a module's prompts must fit (model-windows.ts), which sizes the memory block and the
 * Analyst's pages (templates.resolveCuts): the smallest window of the module's chain, read on each call so a profile
 * change applies at once, and none where no model says or the composition has no models.
 */
import { createContainer } from '@taalcut/core';
import { contextWindowFor } from '@taalcut/models';
import { SMALLEST_WINDOW } from '@taalcut/templates';
import { describe, expect, it } from 'vitest';
import { ModelProfilesToken, ModelRuntimeToken } from '../src/shared/tokens';
import { moduleContextWindow } from '../src/utility/roots/model-windows';
import { testAgent, testConfig } from './helpers/roots';

describe("a module's context window", () => {
  it("is the smallest of the agent chain's windows, and follows the active profile", async () => {
    const root = testAgent(testConfig('agent'));
    await root.start?.();
    const profiles = root.container.resolve(ModelProfilesToken);
    const runtime = root.container.resolve(ModelRuntimeToken);
    const agentWindow = moduleContextWindow(root.container);
    const seen = new Set<number | undefined>();
    for (const profile of profiles.profiles()) {
      await profiles.setActiveProfile(profile.id);
      const windows = profiles
        .effective('agent')
        .chain.map((choice) => runtime.findModel(choice.provider, choice.model, 'chat')?.contextWindow);
      const known = windows.filter((window): window is number => window !== undefined);
      expect(agentWindow('agent'), profile.id).toBe(known.length > 0 ? Math.min(...known) : undefined);
      seen.add(agentWindow('agent'));
    }
    // The same function, read again after each change: the profiles give different windows.
    expect(seen.size).toBeGreaterThan(1);
    await root.container.dispose();
  });

  it('is unknown in a composition without models', () => {
    expect(moduleContextWindow(createContainer())('agent')).toBeUndefined();
  });

  it("is taken, when unknown, as the smallest window a local tier runs: templates' SMALLEST_WINDOW", () => {
    // templates can't import packages/models; this holds its constant to the tiers' windows (LRN1-CTX follow-ups 4).
    const tiers = (['minimum', 'recommended', 'high'] as const).map(contextWindowFor);
    expect(SMALLEST_WINDOW).toBe(Math.min(...tiers));
  });
});
