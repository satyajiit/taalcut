// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- sample model output: data, never translated */

import type { CardOf, RunId, ToolRunId } from '@taalcut/core';
import type { RunTool } from './tool-groups';

/**
 * The agent inspecting eleven clips at once (FIX-TOOLGROUPS, as in the owner's run), in the three states worth
 * seeing: running (four back), done, and done with two that failed. The kit page and the tests show them.
 */
export type ToolGroupFixtureState = 'running' | 'done' | 'partlyFailed';

const RUN = '01K7C5M6Q8R9S0T1V2W3X4Y5Z7' as RunId;
const T0 = 1_760_000_000_000;
/** Fixed, well-formed ULIDs: a prefix, a letter for the state, and the call's number. */
const ID_PREFIX = '01K7C5M6Q8R9S0T1V2W3X4G';
const STATE_MARK: Record<ToolGroupFixtureState, string> = { running: 'R', done: 'D', partlyFailed: 'F' };

/** Which clip each call inspected, as library.getAsset says it (its describeCall): what the expanded rows show. */
export const TOOL_GROUP_SAMPLES: readonly string[] = [
  'IMG_0412.MOV · 0:48',
  'IMG_0413.MOV · 0:12',
  'IMG_0415.MOV · 0:31',
  'IMG_0418.MOV · 0:09',
  'IMG_0420.MOV · 0:22',
  'IMG_0421.MOV · 0:06',
  'IMG_0424.MOV · 0:40',
  'IMG_0427.MOV · 0:15',
  'IMG_0429.MOV · 0:18',
  'IMG_0430.MOV · 0:27',
  'IMG_0433.MOV · 1:05',
];

const timeout = (toolRunId: ToolRunId): NonNullable<CardOf<'toolRun'>['error']> => ({
  code: 'core.timeout',
  messageKey: 'errors.core.timeout',
  retryable: true,
  fix: { command: 'agent.retryStep', labelKey: 'fix.retry', payload: { toolRunId } },
});

function status(state: ToolGroupFixtureState, index: number): CardOf<'toolRun'>['status'] {
  if (state === 'running') return index < 4 ? 'succeeded' : 'running';
  if (state === 'partlyFailed' && (index === 3 || index === 8)) return 'failed';
  return 'succeeded';
}

/**
 * Eleven `library.getAsset` calls in one run, started together at `startedAt` (epoch ms; a fixed time by default,
 * a moment ago on a page that shows the running group's live timer), in `state`.
 */
export function toolGroupFixture(
  state: ToolGroupFixtureState,
  tool = 'library.getAsset',
  startedAt = T0,
): RunTool[] {
  return TOOL_GROUP_SAMPLES.map((summary, index) => {
    const toolRunId = `${ID_PREFIX}${STATE_MARK[state]}${String(index).padStart(2, '0')}` as ToolRunId;
    const called = status(state, index);
    const card: CardOf<'toolRun'> = {
      type: 'toolRun',
      id: `group-${state}-${index}`,
      version: 1,
      runId: RUN,
      toolRunId,
      tool,
      status: called,
      startedAt: startedAt + index * 12,
      ...(called === 'running' ? {} : { finishedAt: startedAt + 900 + index * 140 }),
      ...(called === 'succeeded' ? { summary } : {}),
      ...(called === 'failed' ? { error: timeout(toolRunId) } : {}),
    };
    return { card };
  });
}
