// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1: a refused call outside its step's skill names the step's tools, and a made-up path is told the paths the
 * step's tools returned (MLX1's 4B asked vision.describeFrame for /tmp/frames/<id>/frame_0.png five times).
 */
import type { RunId, TaalcutError } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { RunContext } from '../../src/context';
import { outsideSkillDetail, withRefusalHint } from '../../src/context/refusal-hints';
import { initialState, type ToolCallState } from '../../src/run-state';

const analyst = {
  id: 'templates.analyst',
  tools: { names: ['templates.resolveCuts', 'vision.describeFrame'] },
};

describe('a call outside the step’s skill', () => {
  it('names the step’s tools and handOff', () => {
    const allowed = (name: string) => name !== 'vision.describeFrame';
    expect(outsideSkillDetail(analyst, allowed, 'timeline.get')).toBe(
      "timeline.get is not one of templates.analyst's tools. Use only these: templates.resolveCuts, handOff.",
    );
  });

  it('says to find a family’s tools', () => {
    const librarian = { id: 'timeline.librarian', tools: { families: ['library'] } };
    expect(outsideSkillDetail(librarian, () => true, 'templates.breakdown')).toContain(
      'Find its library tools with findTools.',
    );
  });
});

describe('a file that is not there', () => {
  const frame = '/Users/demo/Library/Caches/Taalcut/breakdowns/01B/slot-3.jpg';
  function context(returned: unknown): RunContext {
    const state = initialState('01RUN0000000000000000000000' as RunId);
    state.stepIndex = 0;
    state.transcript.push({ kind: 'assistant', text: '', toolCallIds: ['t1'], step: 0 } as never);
    state.toolCalls['t1'] = {
      requested: { toolCallId: 't1', tool: 'templates.resolveCuts', input: {} },
      outcome: { kind: 'completed', payload: { output: { kind: 'inline', value: returned } } },
    } as never;
    return { log: { state } } as never;
  }
  const call = (path: string) =>
    ({ requested: { tool: 'vision.describeFrame', input: { path } } }) as ToolCallState;
  const error: TaalcutError = {
    code: 'media.file_not_found',
    messageKey: 'errors.media.file_not_found',
    retryable: false,
    detail: '/tmp/frames/01B/frame_0.png: ENOENT',
  };

  it('lists the paths the step’s tools returned', () => {
    const hinted = withRefusalHint(
      context({ slots: [{ index: 3, frame }] }),
      call('/tmp/frames/01B/frame_0.png'),
      error,
    );
    expect(hinted.detail).toBe(
      `/tmp/frames/01B/frame_0.png: ENOENT No tool returned this path. Paths this step's tools returned: ${frame}. Pass one exactly as returned.`,
    );
  });

  it('says never to make one up when none were returned, and leaves a returned path’s error alone', () => {
    expect(withRefusalHint(context({ slots: [] }), call('/x/y.png'), error).detail).toContain(
      'never one made up',
    );
    expect(withRefusalHint(context({ frame }), call(frame), error)).toBe(error);
  });
});
