// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * listen-parity (EAR1-I3 over EAR1-F5, F6 and A1): one summary of how close @taalcut/audio's port of earshot stays to
 * upstream on the parity fixtures (tools/earshot-parity), each number against its bar in ci-paths.json. The parts
 * without a model always run: calibration from upstream's embeddings, the signal processing, the critique with
 * upstream's model passes, realness from upstream's stored embeddings. The end-to-end part runs our models in one
 * dtype (TAALCUT_LISTEN_DTYPE, fp16 by default) and is skipped, with the reason, where they aren't installed.
 */
import {
  createListenModels,
  createListenSessions,
  createSpectrogramRunner,
  directoryListenFiles,
} from '@taalcut/audio';
import type { ComputeFallbackEvent } from '@taalcut/core';
import { LISTEN_DEVICES, listenModelsHere, type ListenModelsHere } from '../listening/environment';
import { outcomeOf, type ListenOutcome, type MeasuredMetric, type SkippedPart } from '../listening/outcome';
import { calibrationEndToEnd, calibrationFromUpstream } from './calibration';
import { critiqueEndToEnd, critiqueWithUpstreamPasses } from './critique';
import { dspParity } from './dsp';
import { realnessEndToEnd, realnessFromUpstream } from './realness';

type Runner = ReturnType<typeof createSpectrogramRunner>;

async function endToEnd(here: ListenModelsHere, runner: Runner, notes: string[]): Promise<MeasuredMetric[]> {
  const { root, dtype } = here;
  const files = directoryListenFiles(root, dtype);
  const fallbacks: ComputeFallbackEvent[] = [];
  const sessions = createListenSessions({
    files,
    plan: async () => ({ devices: [...LISTEN_DEVICES[dtype]] }),
    onFallback: (event) => fallbacks.push(event),
  });
  // Where each model ran, read while it is open (the sessions release a model once another needs the memory).
  const ran = new Map<string, string>();
  const note = () => {
    for (const name of ['clapAudio', 'clapText', 'ast'] as const) {
      const backend = sessions.backend(name);
      if (backend) ran.set(name, backend);
    }
  };
  try {
    const models = createListenModels(sessions, files);
    const metrics = await calibrationEndToEnd(models, dtype);
    note();
    const realness = await realnessEndToEnd(models.clap, dtype, notes);
    metrics.push(...realness.metrics);
    metrics.push(...(await critiqueEndToEnd(models.ast, realness.results, runner, dtype, notes)));
    note();
    notes.push(
      `- ${dtype} models from ${root}: ${[...ran].map(([name, backend]) => `${name} on ${backend}`).join(', ')}; ` +
        `compute.fallback ${fallbacks.length}` +
        (fallbacks.length > 0 ? ` (${fallbacks.map((f) => `${f.operation}: ${f.reason}`).join('; ')})` : ''),
    );
    return metrics;
  } finally {
    await sessions.release();
  }
}

export async function runParitySuite(): Promise<ListenOutcome> {
  const started = performance.now();
  const notes: string[] = [];
  const skipped: SkippedPart[] = [];
  const runner = createSpectrogramRunner();
  try {
    const metrics: MeasuredMetric[] = [...calibrationFromUpstream()];
    metrics.push(...(await dspParity(runner, notes)));
    metrics.push(...(await critiqueWithUpstreamPasses(runner, notes)));
    metrics.push(...(await realnessFromUpstream(notes)));
    const here = await listenModelsHere(['clapAudio', 'clapText', 'ast']);
    if ('reason' in here) skipped.push({ part: 'end to end', reason: here.reason });
    else metrics.push(...(await endToEnd(here.found, runner, notes)));
    return outcomeOf('listen-parity', {
      metrics,
      skipped,
      notes,
      seconds: (performance.now() - started) / 1000,
    });
  } finally {
    await runner.release();
  }
}
