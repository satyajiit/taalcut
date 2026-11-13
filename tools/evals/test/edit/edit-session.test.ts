// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createScriptedModelClient, scriptedResult } from '@taalcut/agent';
import { unwrap } from '@taalcut/core';
import type { ModelRequest } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { createSessionClient } from '../../src/edit/session';

const request = (system: string): ModelRequest => ({
  module: 'agent',
  system,
  messages: [{ role: 'user', content: 'Make this shorter.' }],
});
const editor = request('# Skill: timeline.editor\n\nA different persona opening.');

describe('the edit eval session boundary', () => {
  it('routes Editor turns by skill identity, independently of persona wording', async () => {
    const live = createScriptedModelClient(() => ({
      toolCalls: [{ name: 'timeline_get', arguments: { timelineId: 'selected' } }],
    }));
    const session = createSessionClient({ live });
    const result = unwrap(await session.complete(editor));
    expect(result.toolCalls.map((call) => call.name)).toEqual(['timeline_get']);
    expect(live.requests).toEqual([editor]);
    expect(session.turns).toEqual([result]);
  });

  it('leaves the recorded Editor turn unconsumed by the run’s closing turn', async () => {
    const recorded = scriptedResult(editor, { text: 'The selected clip is shorter.' });
    const session = createSessionClient({
      replay: {
        caseId: 'boundary',
        model: 'recorded',
        verdict: { pass: true, why: 'ok' },
        turns: [recorded],
      },
    });
    const closing = unwrap(await session.complete(request('You are the Editor in the main run.')));
    expect(closing.text).toBe('Done.');
    expect(session.turns).toEqual([]);
    expect(unwrap(await session.complete(editor))).toBe(recorded);
    expect(session.requests).toEqual([editor]);
  });
});
