// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the Editor's step loads the five tools that best match its description and the step's text (the agent's
 * search; the chat writes the request and the kinds selected). For every non-graphics ask of the edit eval, the tool it needs is among them, and timeline.get always is:
 * the 9B rarely loads a tool itself. A tag or summary change that loses one fails here by case.
 */
import { createSkillRegistry } from '@taalcut/agent';
import { editorCapabilityTools, unwrap, type AnySkill } from '@taalcut/core';
import { createToolRegistry } from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { EDIT_CASES } from '../../src/edit/cases';
import { editEditorCapabilities } from '../../src/edit/editor-catalogue';
import { editStepText } from '../../src/edit/run';
import { editWorld } from '../../src/edit/world';

/** What each ask needs, by case id prefix (the longest prefix wins). */
const NEEDS: Record<string, readonly string[]> = {
  'split-': ['timeline.splitClip'],
  'here-split': ['timeline.splitClip'],
  'delete-': ['timeline.deleteClip'],
  'duplicate-': ['timeline.duplicateClip'],
  'insert-': ['timeline.insertClip'],
  'move-': ['timeline.moveClip'],
  'trim-': ['timeline.trimClip'],
  'slip-': ['timeline.slipClip'],
  'speed-': ['timeline.setSpeed'],
  'here-slow': ['timeline.setSpeed'],
  'transition-': ['timeline.setTransition'],
  'transition-remove': ['timeline.removeTransition'],
  'here-dip': ['timeline.setTransition'],
  'colour-': ['timeline.setGrade'],
  'here-mono': ['timeline.setGrade'],
  'range-mono': ['timeline.setGrade'],
  'sound-': ['audio.setVolume'],
  'sound-music-later': ['audio.move'],
  'here-mute': ['audio.setVolume'],
  'text-': ['timeline.editText'],
  'text-move': ['timeline.moveText'],
  'captions-off': ['captions.setEnabled'],
  'captions-fix': ['captions.editText'],
  'multi-this-half-crossfade': ['timeline.setSpeed', 'timeline.setTransition'],
  'multi-delete-mono': ['timeline.deleteClip', 'timeline.setGrade'],
  'multi-mute-music-fade': ['audio.setVolume'],
  'multi-split-flash': ['timeline.splitClip', 'timeline.setTransition'],
  'multi-slow-fade-out': ['timeline.setSpeed', 'audio.setVolume'],
  'multi-fast-warm': ['timeline.setSpeed', 'timeline.setGrade'],
};

const needs = (id: string) =>
  NEEDS[
    Object.keys(NEEDS)
      .filter((prefix) => id.startsWith(prefix))
      .sort((a, b) => b.length - a.length)[0] ?? ''
  ];

describe('the Editor’s tool routing (EDT1-OPS)', () => {
  it('offers every registered domain capability while retaining unavailable and person-only declarations', async () => {
    const world = await editWorld();
    const registered = createToolRegistry([...world.modules]);
    expect(registered.ok ? null : registered.error).toBeNull();
    const registry = unwrap(registered);
    const skills = unwrap(createSkillRegistry([...world.skills], registry));
    const allowed = skills.subset(skills.get('timeline.editor') as AnySkill);
    const capabilities = editEditorCapabilities((name) => registry.resolve(name) !== undefined);
    expect(allowed).toEqual(expect.arrayContaining(editorCapabilityTools(capabilities)));
    expect(allowed).toContain('editor.capabilities');
    expect(allowed).toContain('history.undo');
    expect(capabilities.find((entry) => entry.id === 'render.export')).toMatchObject({
      available: false,
      reason: 'editor.capability_unavailable',
    });
    expect(allowed).not.toContain('render.export');
    expect(capabilities.find((entry) => entry.id === 'narration.record')).toMatchObject({
      access: 'person',
      tools: [],
      reason: 'editor.microphone_requires_person',
    });
  });

  it('loads the tool each non-graphics ask needs, and timeline.get', async () => {
    const world = await editWorld();
    const registry = unwrap(createToolRegistry([...world.modules]));
    const skills = unwrap(createSkillRegistry([...world.skills], registry));
    const editor = skills.get('timeline.editor') as AnySkill;
    const withheld = new Set(editor.withheldTools?.({ request: 'x' } as never) ?? []);
    const allowed = new Set(skills.subset(editor).filter((name) => !withheld.has(name)));
    // As the agent's skill step does on the 4B's window (skill-step.ts searchSubset, tool-offer.ts): the best five of
    // the skill's own tools.
    const load = (query: string) =>
      registry
        .search(query, { limit: 20 })
        .map((hit) => hit.name)
        .filter((name) => allowed.has(name))
        .slice(0, 5);
    // FIX-CMT: a comment case is a batch, routed by its comments' words (edit-comments.test.ts), not a docked message.
    const docked = EDIT_CASES.filter((edit) => edit.family !== 'graphics' && !edit.comments);
    const missing = docked.flatMap((edit) => {
      const loaded = load(`${editor.description} ${editStepText(edit, world.timeline())}`);
      const lost = [...(needs(edit.id) ?? []), 'timeline.get'].filter((tool) => !loaded.includes(tool));
      return lost.length > 0 ? [`${edit.id}: ${lost.join(', ')} (loaded ${loaded.join(', ')})`] : [];
    });
    expect(missing).toEqual([]);
  });

  it('finds the new editing actions in a five-tool offer', async () => {
    const world = await editWorld();
    const registry = unwrap(createToolRegistry([...world.modules]));
    const skills = unwrap(createSkillRegistry([...world.skills], registry));
    const editor = skills.get('timeline.editor') as AnySkill;
    const allowed = new Set(skills.subset(editor));
    const requests = [
      ['Remove the selected spoken words from the recording.', 'timeline.removeWords'],
      ['Find and replace this caption text in all matching captions.', 'timeline.replaceCaptions'],
      ['Adjust color, sound and framing on these selected clips together.', 'timeline.adjustClips'],
      ['Copy color and sound settings from this clip to those clips.', 'timeline.copyClipSettings'],
      ['Add this saved narration take at the playhead.', 'timeline.addNarration'],
      ['Open the recorder so I can record my voice.', 'timeline.prepareNarration'],
      ['Make a separate square video copy in another size.', 'timeline.makeSize'],
      ['Freeze this moment for two seconds.', 'timeline.freezeFrame'],
      ['Lengthen this hold frame to four seconds.', 'timeline.setHoldDuration'],
      ['Lock this clip so it cannot be edited.', 'timeline.lockClip'],
      ['Undo my last edit.', 'history.undo'],
      ['Undo my last edit.', 'history.get'],
      ['Redo my last edit.', 'history.redo'],
      ['Redo my last edit.', 'history.get'],
    ] as const;
    const missing = requests.flatMap(([request, wanted]) => {
      const loaded = registry
        .search(`${editor.description} ${request}`, { limit: 20 })
        .filter((entry) => allowed.has(entry.name))
        .slice(0, 5)
        .map((entry) => entry.name);
      return loaded.includes(wanted) ? [] : [`${wanted}: ${loaded.join(', ')}`];
    });
    expect(missing).toEqual([]);
  });
});
