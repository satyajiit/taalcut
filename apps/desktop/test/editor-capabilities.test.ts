// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { afterEach, expect, it } from 'vitest';
import { editorCapabilityTools } from '@taalcut/core';
import { ToolModulesToken } from '../src/shared/tokens';
import { editorCapabilities } from '../src/utility/roots/editor-capabilities';
import { closeAllPorts, nodeChannel } from './helpers/fake-utility';
import { testAgent, testConfig } from './helpers/roots';

afterEach(closeAllPorts);
it('every available editor capability names its registered command tools, and person-only actions are excluded', async () => {
  const root = testAgent(testConfig('agent'), { main: nodeChannel().remote });
  try {
    const tools = root.container.resolve(ToolModulesToken).flatMap((module) => module.tools);
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const catalogue = editorCapabilities((name) => byName.has(name));
    for (const entry of catalogue) {
      for (const name of entry.tools) {
        const tool = byName.get(name);
        if (!tool) {
          expect(entry.available, name).toBe(false);
          continue;
        }
        if (tool.command) expect(entry.commands, name).toContain(tool.command);
      }
    }
    const names = editorCapabilityTools(catalogue);
    expect(names).toEqual(
      expect.arrayContaining([
        'timeline.lockClip',
        'timeline.makeVariants',
        'timeline.exportInterchange',
        'render.cancel',
        'render.getQaReport',
        'graphics.useProposal',
        'history.undo',
        'history.redo',
        'timeline.removeWords',
      ]),
    );
    expect(names).not.toContain('narration.record');
    const unavailable = editorCapabilities(() => false);
    expect(editorCapabilityTools(unavailable)).toEqual([]);
    expect(unavailable.find((entry) => entry.id === 'timeline.freezeFrame')).toMatchObject({
      available: false,
      reason: 'editor.capability_unavailable',
    });
  } finally {
    await root.container.dispose();
  }
});
