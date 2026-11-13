// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TOOLGROUPS' contract: what a tool call was about, for people. agent.toolFinished may carry a short summary
 * ("IMG_0412.MOV · 0:48"), a tool may say it (describeCall), and the helpers keep it to a file name, a clock and one
 * bounded line.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  agentToolFinishedSchema,
  agentToolStartedSchema,
  callClock,
  defineTool,
  fileNameOf,
  newId,
  NO_TOOL_RETRY,
  ok,
  TOOL_CALL_SUMMARY_MAX,
  toolCallSummary,
} from '@taalcut/core';

const finished = {
  runId: newId<'AgentRun'>(),
  toolRunId: newId<'ToolRun'>(),
  tool: 'library.getAsset',
  status: 'succeeded',
  durationMs: 120,
};

describe('agent.toolFinished’s summary', () => {
  it('is optional, so events from before it still parse', () => {
    expect(agentToolFinishedSchema.safeParse(finished).success).toBe(true);
    const parsed = agentToolFinishedSchema.parse({ ...finished, summary: 'IMG_0412.MOV · 0:48' });
    expect(parsed.summary).toBe('IMG_0412.MOV · 0:48');
  });

  it('is one short line: never empty, never longer than the bound', () => {
    expect(agentToolFinishedSchema.safeParse({ ...finished, summary: '' }).success).toBe(false);
    const long = 'x'.repeat(TOOL_CALL_SUMMARY_MAX + 1);
    expect(agentToolFinishedSchema.safeParse({ ...finished, summary: long }).success).toBe(false);
    expect(TOOL_CALL_SUMMARY_MAX).toBe(200);
  });

  it('is not on agent.toolStarted: the input alone names ids, not files', () => {
    const started = agentToolStartedSchema.parse({ ...finished, sideEffect: 'read', summary: 'dropped' });
    expect(started).not.toHaveProperty('summary');
  });
});

describe('the helpers a tool describes a call with', () => {
  it('fileNameOf keeps the file’s own name, never the folders', () => {
    expect(fileNameOf('/Users/me/Trip/IMG_0412.MOV')).toBe('IMG_0412.MOV');
    expect(fileNameOf('C:\\Users\\me\\Trip\\IMG_0412.MOV')).toBe('IMG_0412.MOV');
    expect(fileNameOf('/Users/me/Trip/')).toBe('Trip');
    expect(fileNameOf('IMG_0412.MOV')).toBe('IMG_0412.MOV');
    expect(fileNameOf('')).toBe('');
  });

  it('callClock says a time as a clock, in no language', () => {
    expect(callClock(0)).toBe('0:00');
    expect(callClock(48.9)).toBe('0:48');
    expect(callClock(725)).toBe('12:05');
    expect(callClock(3729)).toBe('1:02:09');
    expect(callClock(-5)).toBe('0:00');
    expect(callClock(Number.NaN)).toBe('0:00');
  });

  it('toolCallSummary makes one bounded line, or nothing', () => {
    expect(toolCallSummary('  IMG_0412.MOV\n·\t0:48 ')).toBe('IMG_0412.MOV · 0:48');
    expect(toolCallSummary('IMG\u0007_0412\u200b.MOV')).toBe('IMG _0412.MOV');
    const cut = toolCallSummary('a'.repeat(500))!;
    expect(cut).toHaveLength(TOOL_CALL_SUMMARY_MAX);
    expect(cut.endsWith('…')).toBe(true);
    expect(agentToolFinishedSchema.safeParse({ ...finished, summary: cut }).success).toBe(true);
    expect(toolCallSummary(' \n ')).toBeUndefined();
    expect(toolCallSummary(undefined)).toBeUndefined();
    expect(toolCallSummary(null)).toBeUndefined();
  });

  it('a tool may describe its calls from its input and output', () => {
    const tool = defineTool({
      name: 'library.getThing',
      version: '1.0.0',
      description: 'Reads a thing.',
      input: z.object({ path: z.string() }),
      output: z.object({ seconds: z.number() }),
      costClass: 'local',
      sideEffect: 'read',
      timeoutMs: 1_000,
      retry: NO_TOOL_RETRY,
      describeCall: (input, output) => `${fileNameOf(input.path)} · ${callClock(output.seconds)}`,
      run: async () => ok({ seconds: 48 }),
    });
    expect(tool.describeCall?.({ path: '/a/b/IMG_0412.MOV' }, { seconds: 48 })).toBe('IMG_0412.MOV · 0:48');
  });
});
