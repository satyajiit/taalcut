// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F7 wiring in the jobs process (roots/audio-listen.ts, machineListenPlan): the listen jobs are composed with the
 * service and core's SoundListener; a model the component manager can't provide fails the job with
 * `audio.listen_model_missing` naming the component, installed on demand or not; the device plan is the host's
 * listen row for the probed machine, the CPU alone (`disabled`) when forced.
 */
import {
  createContainer,
  createDirectJobRunner,
  createEventBus,
  createManualClock,
  err,
  EventBusToken,
  NotFoundError,
  SoundListenerToken,
} from '@taalcut/core';
import { audioListenAnalyseJob, audioListenQueryJob, listenDevicePlan } from '@taalcut/audio';
import type { ComponentManager } from '@taalcut/jobs';
import type { MediaService } from '@taalcut/media';
import type { HardwareInfo } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { hostPlatform } from '../src/platform';
import type { ProbedHardware } from '../src/shared/tokens';
import { composeListen, ListenServiceToken } from '../src/utility/roots/audio-listen';
import {
  componentsRoot,
  machineAccelerators,
  machineListenPlan,
} from '../src/utility/roots/machine-accelerators';
import { testConfig } from './helpers/roots';

const m1: HardwareInfo = {
  platform: 'darwin',
  arch: 'arm64',
  chip: 'Apple M1',
  memoryBytes: 8 * 1024 ** 3,
  gpus: [{ name: 'Apple M1', vendor: 'apple', unifiedMemory: true, apis: ['metal'] }],
  neuralEngine: true,
  cpuCores: { total: 8 },
  freeDiskBytes: 1e12,
  osVersion: '15.1',
};
const probed = (info: HardwareInfo) => async () => ({ info }) as unknown as ProbedHardware;

describe('machineListenPlan', () => {
  it("plans the listen models on this host's row for the probed machine", async () => {
    const plan = await machineListenPlan(probed(m1), componentsRoot('/u'))();
    const { cudaLibraries, ...devices } = plan;
    expect(devices).toEqual(listenDevicePlan(hostPlatform().name, machineAccelerators(m1)));
    expect(typeof cudaLibraries?.installedRuntime).toBe('function');
  });

  it.runIf(process.platform === 'darwin')('takes WebGPU (Metal) first on a Mac', async () => {
    expect((await machineListenPlan(probed(m1), componentsRoot('/u'))()).devices).toEqual(['webgpu', 'cpu']);
  });

  it('records TAALCUT_FORCE_CPU as disabled: the CPU alone', async () => {
    const forced = { ...m1, gpus: m1.gpus.map((gpu) => ({ ...gpu, apis: [] })), forcedCpu: true };
    const plan = await machineListenPlan(probed(forced), componentsRoot('/u'))();
    expect(plan.devices).toEqual(['cpu']);
    expect(plan.cpuReason?.reason).toBe('disabled');
  });
});

describe('composeListen', () => {
  function compose() {
    const container = createContainer().value(EventBusToken, createEventBus({ clock: createManualClock(0) }));
    const asked: string[] = [];
    const components = {
      install: async (id: string) => (
        asked.push(`install:${id}`),
        err(NotFoundError({ entity: 'component', id }))
      ),
      get: async (id: string) => (asked.push(`get:${id}`), undefined),
    } as unknown as ComponentManager;
    const media = {
      binaries: async () => err(NotFoundError({ entity: 'ffmpeg', id: 'ffmpeg' })),
    } as unknown as MediaService;
    const { jobs } = composeListen(container, testConfig('jobs'), {
      media,
      components: () => components,
      log: () => undefined,
    });
    return { container, jobs, asked };
  }

  it('serves the listen kinds, the service and core’s SoundListener', async () => {
    const { container, jobs } = compose();
    expect(jobs.map((job) => job.kind.kind)).toEqual(['audio.listen.analyse', 'audio.listen.query']);
    const service = container.resolve(ListenServiceToken);
    expect(container.resolve(SoundListenerToken)).toBe(service.listener);
    expect(service.resident()).toEqual([]);
    await container.dispose();
  });

  it('a model it can’t install fails the job with audio.listen_model_missing naming the component', async () => {
    const { container, jobs, asked } = compose();
    const runner = createDirectJobRunner(jobs);
    const analysed = await runner.run(audioListenAnalyseJob, { path: '/no/clip.wav', want: { tags: true } });
    expect(!analysed.ok && analysed.error.code).toBe('audio.listen_model_missing');
    expect(!analysed.ok && analysed.error.params).toEqual({ component: 'clap-general-audio' });
    expect(asked).toContain('install:clap-general-audio');

    asked.length = 0;
    const installedOnly = await runner.run(audioListenAnalyseJob, {
      path: '/no/clip.wav',
      want: { realness: true },
      install: false,
    });
    expect(!installedOnly.ok && installedOnly.error.params).toEqual({ component: 'clap-general-audio' });
    expect(asked.some((call) => call.startsWith('install:'))).toBe(false);

    const queried = await runner.run(audioListenQueryJob, {
      op: 'describe',
      sources: [{ path: '/no/clip.wav' }],
      params: {},
    });
    expect(!queried.ok && queried.error.code).toBe('audio.listen_model_missing');
    await container.dispose();
  });
});
