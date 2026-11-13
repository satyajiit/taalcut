// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TOOLGROUPS: the executor asks a tool what a call was about (describeCall) and keeps it on the result as one
 * bounded line, for the chat. A tool that says nothing, or throws saying it, still succeeds; the words never reach
 * the model's output.
 */
import { ok, TOOL_CALL_SUMMARY_MAX } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { fxModule, fxTool, inRun, setup } from './helpers';

const named = fxTool({
  run: async (input) => ok({ n: (input as { n: number }).n * 2 }),
  describeCall: (input: { n: number }, output: { n: number }) => `IMG_04${input.n}.MOV\n· 0:${output.n}`,
});

describe('a call’s summary', () => {
  it('is the tool’s words for its input and output, as one line beside the output', async () => {
    const { executor } = setup({ modules: [fxModule(named)] });
    const result = await executor.execute('fx.thing', { n: 12 }, inRun());
    expect(result.ok && result.value.summary).toBe('IMG_0412.MOV · 0:24');
    expect(result.ok && result.value.output).toEqual({ kind: 'inline', value: { n: 24 } });
  });

  it('is kept for a cached answer and a repeated call', async () => {
    const cached = { ...named, cache: { ttlMs: 60_000 } };
    const { executor } = setup({ modules: [fxModule(cached)] });
    await executor.execute('fx.thing', { n: 12 }, inRun());
    const again = await executor.execute('fx.thing', { n: 12 }, inRun());
    expect(again.ok && [again.value.cached, again.value.summary]).toEqual([true, 'IMG_0412.MOV · 0:24']);
  });

  it('is cut to the bound', async () => {
    const long = fxTool({
      run: async () => ok({ n: 1 }),
      describeCall: () => `${'IMG_0412.MOV '.repeat(40)}`,
    });
    const { executor } = setup({ modules: [fxModule(long)] });
    const result = await executor.execute('fx.thing', {}, inRun());
    const summary = result.ok ? result.value.summary : undefined;
    expect(summary).toHaveLength(TOOL_CALL_SUMMARY_MAX);
    expect(summary?.endsWith('…')).toBe(true);
  });

  it('is absent when the tool says nothing, says only white space, or throws', async () => {
    const silent = fxTool({ run: async () => ok({ n: 1 }) });
    const blank = fxTool({ name: 'fx.blank', run: async () => ok({ n: 1 }), describeCall: () => ' \n ' });
    const broken = fxTool({
      name: 'fx.broken',
      run: async () => ok({ n: 1 }),
      describeCall: () => {
        throw new Error('no words');
      },
    });
    const { executor } = setup({ modules: [fxModule(silent, blank, broken)] });
    for (const name of ['fx.thing', 'fx.blank', 'fx.broken']) {
      const result = await executor.execute(name, {}, inRun());
      expect(result.ok, name).toBe(true);
      expect(result.ok && 'summary' in result.value, name).toBe(false);
    }
  });

  it('is never asked for when the call failed', async () => {
    let asked = 0;
    const failing = fxTool({
      run: async () => ok({ n: 'not a number' }),
      describeCall: () => (asked++, 'IMG_0412.MOV'),
    });
    const { executor } = setup({ modules: [fxModule(failing)] });
    const result = await executor.execute('fx.thing', {}, inRun());
    expect(!result.ok && result.error.code).toBe('tools.invalid_output');
    expect(asked).toBe(0);
  });
});
