// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: who is given the length tools. The Maker (1.7.0) while making and the Editor (2.12.0) on a request in the
 * editor's chat: both list `timeline.musicBars` and `timeline.lengthenSlot`, both are pointed at one guide
 * (workspace.docs, taalcut/edit-longer), and the Maker is given MATCH1's `library.frameStrip` where it is
 * registered. The Librarian is as it was.
 */
import { editorCapabilityTools, type AnySkill } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { timelineEditorCapabilities } from '../src/editor-capabilities';
import { editorSkill } from '../src/skills/editor-skill';
import { MAKER_PROMPT } from '../src/skills/maker-prompt';
import { MAKER_SKILL_ID } from '../src/skills/maker-skill';
import { EDITOR_PROMPT } from '../src/skills/prompts';
import { timelineSkillModule } from '../src/skills/skills';
import { agentWorld } from './fixtures/agent';

const LENGTH_TOOLS = ['timeline.musicBars', 'timeline.lengthenSlot'];

function skills(registered: (name: string) => boolean) {
  const world = agentWorld();
  const module = timelineSkillModule({
    service: world.service,
    templates: world.templates,
    maker: { registered },
  });
  const of = (id: string) => module.skills.find((skill) => skill.id === id) as AnySkill;
  return {
    world,
    maker: of(MAKER_SKILL_ID),
    editor: of('timeline.editor'),
    librarian: of('timeline.librarian'),
  };
}

describe('the skills that can make a video longer (LONG1)', () => {
  it('the Maker 1.7.0 lists the length tools and library.frameStrip, and its prompt names the guide', () => {
    const { maker } = skills(() => true);
    expect(maker.version).toBe('1.7.0');
    for (const name of [...LENGTH_TOOLS, 'library.frameStrip']) expect(maker.tools.names).toContain(name);
    expect(MAKER_PROMPT).toContain('a clip that needs longer than its slot → taalcut/edit-longer');
    // Only where the composition registers them.
    const without = skills((name) => name !== 'library.frameStrip' && name !== 'timeline.lengthenSlot').maker;
    expect(without.tools.names).not.toContain('library.frameStrip');
    expect(without.tools.names).not.toContain('timeline.lengthenSlot');
    expect(without.tools.names).toContain('timeline.musicBars');
  });

  it('the Editor 2.12.0 lists them in the make flow and, by its capabilities, in the editor’s chat', () => {
    const { editor, world } = skills(() => true);
    expect(editor.version).toBe('2.12.0');
    for (const name of LENGTH_TOOLS) expect(editor.tools.names).toContain(name);
    expect(timelineEditorCapabilities.find((entry) => entry.id === 'timeline.lengthenSlot')).toEqual({
      id: 'timeline.lengthenSlot',
      commands: ['timeline.lengthenSlot'],
      tools: ['timeline.lengthenSlot'],
      access: 'ai',
    });
    expect(timelineEditorCapabilities.find((entry) => entry.id === 'timeline.musicBars')).toEqual({
      id: 'timeline.musicBars',
      commands: [],
      tools: ['timeline.musicBars'],
      access: 'ai',
    });
    const docked = editorSkill(
      { service: world.service, capabilities: timelineEditorCapabilities },
      () => 'card',
    );
    for (const name of LENGTH_TOOLS) {
      expect(editorCapabilityTools(timelineEditorCapabilities)).toContain(name);
      expect(docked.tools.names).toContain(name);
    }
    expect(EDITOR_PROMPT).toContain('targets or longer (a clip or the video running longer)');
  });

  it('the Librarian is as MATCH1 left it', () => {
    const { librarian } = skills(() => true);
    expect(librarian.version).toBe('1.8.0');
    for (const name of LENGTH_TOOLS) expect(librarian.tools.names).not.toContain(name);
  });
});
