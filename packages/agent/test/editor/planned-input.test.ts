// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { call, ofType, turns } from '../support/harness';
import { contextOf, editorHarness, editorWorld } from './editor-support';

describe('an editor question delegated by the planner', () => {
  it.each([undefined, 'Inspect the bright whites in the selected shot.'])(
    'inherits dock context when the planned input omits projectId (request: %s)',
    async (request) => {
      const world = editorWorld();
      const timeline = world.v.timeline;
      const clipId = world.v.clipIds.find((id) => id !== null)!;
      const editorContext = contextOf(world, { selection: [clipId] });
      const message = 'dont u think , its too much white light ?';
      const h = editorHarness(
        world,
        turns(
          {
            toolCalls: [
              call('updatePlan', {
                steps: [
                  {
                    text: 'Inspect the selected shot.',
                    skill: 'timeline.editor',
                    input: { timelineId: timeline.id, clipId, ...(request ? { request } : {}) },
                  },
                ],
              }),
            ],
          },
          { toolCalls: [call('timeline_get', { timelineId: timeline.id })] },
          { toolCalls: [call('handOff', { timelineId: timeline.id, revision: timeline.revision })] },
          { text: 'I checked the selected shot.' },
        ),
      );
      const result = unwrap(await h.agent.run({ conversationId: 'airport', message, editorContext }));
      expect(result.status).toBe('completed');
      const events = await h.events(result.runId);
      expect(ofType(events, 'run.started')[0]?.payload.editor?.route).toBe('answer');
      expect(ofType(events, 'skill.entered')[0]?.payload.input).toMatchObject({
        projectId: timeline.projectId,
        timelineId: timeline.id,
        request: request ?? message,
        targets: [expect.objectContaining({ itemId: clipId })],
        context: editorContext,
      });
      expect(ofType(events, 'tool.completed').length).toBeGreaterThan(1);
      expect(world.toolEditors).toEqual([]);
    },
  );

  it('does not apply dock defaults to a different timeline', async () => {
    const world = editorWorld();
    const h = editorHarness(
      world,
      turns({
        toolCalls: [
          call('updatePlan', {
            steps: [
              {
                text: 'Inspect another timeline.',
                skill: 'timeline.editor',
                input: { timelineId: newId<'Timeline'>() },
              },
            ],
          }),
        ],
      }),
    );
    const result = unwrap(
      await h.agent.run({
        conversationId: 'airport',
        message: 'What about the other video?',
        editorContext: contextOf(world),
      }),
    );
    expect(result).toMatchObject({ status: 'failed', error: { code: 'agent.skill_input_invalid' } });
    expect(ofType(await h.events(result.runId), 'skill.entered')).toEqual([]);
  });
});
