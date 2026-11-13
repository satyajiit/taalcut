// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Done when: unplugging power lowers concurrency (simulated PowerState). Plus per-class limits. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONCURRENCY, defaultThrottle, defineJob, type ResourceClass } from '../../src/index';
import { deferred, fakePower, testEngine, waitFor } from './helpers';

/** Jobs that block until the test lets them go, tracking how many run at once. */
function gatedJobs(resourceClass: ResourceClass) {
  let running = 0;
  let peak = 0;
  const gates: (() => void)[] = [];
  const definition = defineJob({
    kind: `test.${resourceClass}`,
    resourceClass,
    handler: async () => {
      running++;
      peak = Math.max(peak, running);
      const gate = deferred();
      gates.push(gate.resolve);
      await gate.promise;
      running--;
    },
  });
  return {
    definition,
    running: () => running,
    peak: () => peak,
    resetPeak: () => (peak = running),
    releaseOne: () => gates.shift()?.(),
  };
}

describe('job engine: concurrency and power', () => {
  it('limits concurrency per resource class independently', async () => {
    const { engine } = testEngine({ concurrency: { cpu: 2, io: 3 } });
    const cpu = gatedJobs('cpu');
    const io = gatedJobs('io');
    engine.register(cpu.definition);
    engine.register(io.definition);
    await engine.start();
    for (let i = 0; i < 5; i++) {
      await engine.enqueue(cpu.definition, {});
      await engine.enqueue(io.definition, {});
    }
    await waitFor(() => cpu.running() === 2 && io.running() === 3);
    expect(engine.running()).toHaveLength(5);
    while (cpu.running() + io.running() > 0) {
      cpu.releaseOne();
      io.releaseOne();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(cpu.peak()).toBe(2);
    expect(io.peak()).toBe(3);
  });

  it('lowers CPU concurrency when the Mac is unplugged, and restores it on AC', async () => {
    const power = fakePower();
    const { engine, ofType } = testEngine({ power, concurrency: { cpu: 4 } });
    const cpu = gatedJobs('cpu');
    engine.register(cpu.definition);
    await engine.start();
    for (let i = 0; i < 12; i++) await engine.enqueue(cpu.definition, {});
    await waitFor(() => cpu.running() === 4, 3000, 'four running on AC');

    power.set({ onBattery: true });
    expect(engine.limits().cpu).toBe(2);
    expect(ofType('queue.limits_changed').at(-1)).toMatchObject({
      limits: { cpu: 2 },
      power: { onBattery: true },
    });
    // Running jobs aren't interrupted; as they finish, no more than two run.
    cpu.resetPeak();
    for (let i = 0; i < 4; i++) cpu.releaseOne();
    await waitFor(() => cpu.running() === 2, 3000, 'two running on battery');
    await new Promise((r) => setTimeout(r, 60));
    expect(cpu.running()).toBe(2);
    expect(cpu.peak()).toBeLessThanOrEqual(4);

    power.set({ onBattery: false });
    await waitFor(() => cpu.running() === 4, 3000, 'back to four on AC');
    while (cpu.running() > 0) {
      cpu.releaseOne();
      await new Promise((r) => setTimeout(r, 5));
    }
  });

  it('stops new CPU/GPU work at critical temperature and resumes when it cools', async () => {
    const power = fakePower({ thermalState: 'critical' });
    const { engine } = testEngine({ power });
    const cpu = gatedJobs('cpu');
    engine.register(cpu.definition);
    await engine.start();
    await engine.enqueue(cpu.definition, {});
    await new Promise((r) => setTimeout(r, 60));
    expect(cpu.running()).toBe(0);
    power.set({ thermalState: 'fair' });
    await waitFor(() => cpu.running() === 1);
    cpu.releaseOne();
    power.set({ thermalState: 'fair' }); // no change, no event
  });

  it('default throttle: battery halves heavy work, serious caps it at one, critical stops it', () => {
    const base = { cpu: 6, gpu: 2, npu: 2, video: 4, io: 8, network: 4 };
    expect(defaultThrottle(base, { onBattery: false, thermalState: 'nominal' })).toEqual(base);
    expect(defaultThrottle(base, { onBattery: false, thermalState: 'fair' })).toEqual(base);
    expect(defaultThrottle(base, { onBattery: true, thermalState: 'nominal' })).toEqual({
      ...base,
      cpu: 3,
      gpu: 1,
      npu: 1,
      video: 2,
    });
    expect(defaultThrottle(base, { onBattery: false, thermalState: 'serious' })).toEqual({
      cpu: 1,
      gpu: 1,
      npu: 1,
      video: 1,
      io: 4,
      network: 4,
    });
    expect(defaultThrottle(base, { onBattery: true, thermalState: 'critical' })).toEqual({
      cpu: 0,
      gpu: 0,
      npu: 0,
      video: 0,
      io: 1,
      network: 1,
    });
    expect(defaultThrottle(DEFAULT_CONCURRENCY, { onBattery: true, thermalState: 'nominal' }).cpu).toBe(1);
  });
});
