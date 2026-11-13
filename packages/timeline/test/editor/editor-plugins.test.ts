// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { editorSkill } from '../../src/skills/editor-skill';
import { EDITOR_PLUGIN_TOOLS } from '../../src/skills/editor-plugins';
import { agentWorld } from '../fixtures/agent';

describe('Editor Instagram Edits handoff capabilities', () => {
  it('offers existing policy-gated plugin wrappers only where registered, including capability-limited editors', () => {
    const world = agentWorld();
    const make = (registered: (name: string) => boolean) =>
      editorSkill({ service: world.service, capabilities: [], registered }, () => 'card');
    const available = make(() => true);
    const unavailable = make((name) => !name.startsWith('plugins.'));
    for (const name of EDITOR_PLUGIN_TOOLS) {
      expect(available.tools.names).toContain(name);
      expect(unavailable.tools.names).not.toContain(name);
    }
    expect(available.prompt).toContain('workspace.docs topic taalcut/edit-edits');
    expect(available.prompt).toContain('staging that exact ready render');
    expect(available.prompt).toContain('never authorizes Share to Instagram, publication or scheduling');
    expect(
      available.output.parse({
        timelineId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        revision: 42,
        notStagedReason: 'Plugin disconnected.',
      }),
    ).toHaveProperty('notStagedReason', 'Plugin disconnected.');
  });
});

describe('Editor listening tools', () => {
  it('EAR1-A3: hears a sound and scores the mix only where the listening tools are registered (2.7.0)', () => {
    const world = agentWorld();
    const make = (registered: (name: string) => boolean) =>
      editorSkill({ service: world.service, capabilities: [], registered }, () => 'card');
    const listening = make(() => true);
    const without = make((name) => !name.startsWith('audio.'));
    expect(listening.version).toBe('2.8.0');
    for (const name of ['audio.listen', 'audio.critique']) {
      expect(listening.tools.names).toContain(name);
      expect(without.tools.names).not.toContain(name);
    }
    // The cloud critique asks every time and is no Editor tool; compare is the Reviewer's.
    for (const name of ['audio.cloudCritique', 'audio.compare'])
      expect(listening.tools.names).not.toContain(name);
  });
});
