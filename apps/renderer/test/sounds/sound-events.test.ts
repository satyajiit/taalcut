// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { EDITOR_COMMANDS, SETTINGS_COMMANDS, TIMELINE_COMMANDS, newId, type EventOf } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { command, setup } from './sound-event-fixtures';

describe('editor sound events', () => {
  it.each([
    TIMELINE_COMMANDS.trimClip,
    TIMELINE_COMMANDS.swapClip,
    TIMELINE_COMMANDS.applyCast,
    TIMELINE_COMMANDS.applyCleanup,
    TIMELINE_COMMANDS.editText,
    TIMELINE_COMMANDS.setStyle,
    EDITOR_COMMANDS.splitClip,
    EDITOR_COMMANDS.deleteClip,
    EDITOR_COMMANDS.setGrade,
  ])('announces a successful UI %s command', (name) => {
    const { sounds, handle } = setup();
    const event = command({ name });
    handle(event);
    expect(sounds.play).toHaveBeenCalledWith('editApplied', `command:${event.payload.id}:executed:1`);
  });

  it('keeps agent, MCP and projectless edits silent', () => {
    const { sounds, handle } = setup();
    for (const source of ['agent', 'mcp'] as const) handle(command({ source }));
    handle(command({ projectId: null }));
    expect(sounds.play).not.toHaveBeenCalled();
  });

  it('announces keyboard edits and history with the same policy as UI actions', () => {
    const { sounds, handle } = setup();
    handle(command({ source: 'shortcut' }));
    handle(command({ source: 'shortcut', kind: 'undone' }, 2));
    handle(command({ source: 'shortcut', kind: 'redone' }, 3));
    expect(sounds.play.mock.calls.map(([cue]) => cue)).toEqual(['editApplied', 'undo', 'redo']);
  });

  it('keeps creation, settings and unrelated successful commands silent', () => {
    const { sounds, handle } = setup();
    for (const name of [
      TIMELINE_COMMANDS.create,
      'project.rename',
      'settings.setTheme',
      'timeline.unknown',
    ]) {
      handle(command({ name }));
    }
    expect(sounds.play).not.toHaveBeenCalled();
  });

  it('gives duplicate delivery the same identity and later undo/redo cycles distinct identities', () => {
    const { sounds, handle } = setup();
    const original = command();
    const id = original.payload.id;
    handle(original);
    handle(original);
    handle(command({ id, kind: 'undone' }, 2));
    handle(command({ id, kind: 'redone' }, 3));
    handle(command({ id, kind: 'undone' }, 4));
    handle(command({ id, kind: 'redone' }, 5));
    expect(sounds.play.mock.calls).toEqual([
      ['editApplied', `command:${id}:executed:1`],
      ['editApplied', `command:${id}:executed:1`],
      ['undo', `command:${id}:undone:2`],
      ['redo', `command:${id}:redone:3`],
      ['undo', `command:${id}:undone:4`],
      ['redo', `command:${id}:redone:5`],
    ]);
  });

  it.each([TIMELINE_COMMANDS.create, 'audio.setGain'])('announces editor history for %s', (name) => {
    const { sounds, handle } = setup();
    handle(command({ name, kind: 'undone' }));
    handle(command({ name, kind: 'redone' }, 2));
    expect(sounds.play.mock.calls.map(([cue]) => cue)).toEqual(['undo', 'redo']);
  });

  it('does not announce settings, project or agent history', () => {
    const { sounds, handle } = setup();
    for (const kind of ['undone', 'redone'] as const) {
      handle(command({ name: 'settings.setTheme', kind }));
      handle(command({ name: 'project.rename', kind }));
      handle(command({ kind, source: 'agent' }));
    }
    expect(sounds.play).not.toHaveBeenCalled();
  });

  it('refreshes the global preference after settings commands and recovery, without cues', () => {
    const { sounds, preference, handle } = setup();
    handle(command({ name: SETTINGS_COMMANDS.setInterfaceSounds, projectId: null }));
    handle(command({ name: SETTINGS_COMMANDS.initializeInterfaceSounds, source: 'agent', projectId: null }));
    handle({ type: 'recovery.changed', at: 3, payload: { reason: 'agent-restarted', unfinishedRuns: 0 } });
    expect(preference.changed).toHaveBeenCalledTimes(3);
    expect(sounds.play).not.toHaveBeenCalled();
  });
});

describe('milestone sound events', () => {
  it('only announces successful live assembly and preserves its identity across delivery', () => {
    const { sounds, handle } = setup();
    const event: EventOf<'agent.toolFinished'> = {
      type: 'agent.toolFinished',
      at: 1,
      payload: {
        runId: newId<'AgentRun'>(),
        toolRunId: newId<'ToolRun'>(),
        tool: 'timeline.assemble',
        status: 'succeeded',
        durationMs: 100,
      },
    };
    for (const status of ['failed', 'cancelled'] as const)
      handle({ ...event, payload: { ...event.payload, status } });
    handle({ ...event, payload: { ...event.payload, tool: 'timeline.create' } });
    expect(sounds.play).not.toHaveBeenCalled();
    handle(event);
    handle({ ...event, at: 2 });
    expect(sounds.play.mock.calls).toEqual([
      ['draftAssembled', `assembly:${event.payload.toolRunId}`],
      ['draftAssembled', `assembly:${event.payload.toolRunId}`],
    ]);
  });

  it('only announces a ready export and preserves the render identity across delivery', () => {
    const { sounds, handle } = setup();
    const event: EventOf<'render.finished'> = {
      type: 'render.finished',
      at: 1,
      payload: {
        renderId: newId<'Render'>(),
        projectId: newId<'Project'>(),
        status: 'ready',
        notify: false,
        name: 'Trip',
      },
    };
    for (const status of ['needsAttention', 'failed', 'cancelled'] as const) {
      handle({ ...event, payload: { ...event.payload, status } });
    }
    expect(sounds.play).not.toHaveBeenCalled();
    handle(event);
    handle({ ...event, at: 2 });
    expect(sounds.play.mock.calls).toEqual([
      ['complete', `render:${event.payload.renderId}`],
      ['complete', `render:${event.payload.renderId}`],
    ]);
  });
});
