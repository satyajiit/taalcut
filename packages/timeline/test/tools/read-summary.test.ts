// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** FIX-TOOLGROUPS: timeline.get says which timeline a call read, by its name and length, for the call's chat row. */
import { callClock } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { agentWorld } from '../fixtures/agent';

describe('timeline.get describes its call', () => {
  it('by the timeline’s name and length, read from a real timeline', async () => {
    const { call, template, projectId, tools } = agentWorld();
    const assembled = await call('timeline.assemble', {
      projectId,
      template: { id: template.id },
      variants: 1,
    });
    if (!assembled.ok) throw new Error(assembled.error.code);
    const [timelineId] = assembled.value.timelineIds as string[];
    const read = await call('timeline.get', { timelineId });
    if (!read.ok) throw new Error(read.error.code);
    const get = tools.tools.find((tool) => tool.name === 'timeline.get')!;
    const { name, frames, rate } = read.value as {
      name: string;
      frames: number;
      rate: { num: number; den: number };
    };
    expect(name.length).toBeLessThan(60);
    expect(get.describeCall?.({ timelineId }, read.value)).toBe(
      `${name} · ${callClock((frames * rate.den) / rate.num)}`,
    );
  });

  it('cuts a long name, and says the length alone when there is no name', () => {
    const get = agentWorld().tools.tools.find((tool) => tool.name === 'timeline.get')!;
    const rate = { num: 30, den: 1 };
    expect(get.describeCall?.({}, { name: 'Goa trip', frames: 960, rate })).toBe('Goa trip · 0:32');
    const long = get.describeCall?.(
      {},
      { name: `A reel's whole title ${'and more '.repeat(20)}`, frames: 90, rate },
    );
    expect(long).toMatch(/^A reel's whole title and more .*… · 0:03$/);
    expect(long!.length).toBeLessThanOrEqual(60 + ' · 0:03'.length);
    expect(get.describeCall?.({}, { name: ' \n ', frames: 2_250, rate: { num: 30_000, den: 1001 } })).toBe(
      '1:15',
    );
  });
});
