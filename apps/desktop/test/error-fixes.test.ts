// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every error's own fix names a command the app runs. An error card dispatches its fix on the agent's bus
 * (fix-command.ts); a name nothing registers comes back as core.not_found, and the button shows "That is no
 * longer here". "Open Accounts" and "Open Models" did that until they were registered.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CommandBusToken, definedErrorFixes } from '@taalcut/core';
import { testAgent, testConfig } from './helpers/roots';

const roots: { dispose(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => root.dispose()));
});

describe('error fixes', () => {
  it("name commands on the agent's bus, for every error the agent process defines", async () => {
    const root = testAgent(testConfig('agent', ':memory:'));
    roots.push(root.container);
    const registered = new Set(
      root.container
        .resolve(CommandBusToken)
        .list()
        .map((command) => command.name),
    );
    const fixes = definedErrorFixes();
    // The agent process loads every package that raises these, so the registry is full by now.
    expect(fixes.get('models.not_configured')?.command).toBe('settings.openAccounts');
    const missing = [...fixes]
      .filter(([, fix]) => !registered.has(fix.command))
      .map(([code, fix]) => `${code} → ${fix.command}`);
    expect(missing).toEqual([]);
  });
});
