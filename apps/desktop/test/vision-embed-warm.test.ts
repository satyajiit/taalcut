// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The embedder's warm start (IX-E4): an import starting (a file hashed or
 * normalised) loads the model, where the machine's profile says so; other
 * jobs and other states don't, and the subscription ends when disposed.
 */
import { describe, expect, it } from 'vitest';
import { createEventBus, newId, systemClock, type EventBus, type JobState } from '@taalcut/core';
import { warmEmbedderOnImport } from '../src/utility/roots/vision-embedder';

function job(bus: EventBus, kind: string, to: JobState): void {
  bus.emit('job.stateChanged', {
    jobId: newId<'Job'>(),
    kind,
    projectId: null,
    from: 'queued',
    to,
    attempt: 1,
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeEmbedder(warmsOnImport: boolean) {
  let warms = 0;
  return {
    embedder: { warm: async () => void warms++, warmsOnImport: async () => warmsOnImport },
    warms: () => warms,
  };
}

describe('warmEmbedderOnImport', () => {
  it('warms the embedder when hashing or normalising starts', async () => {
    const bus = createEventBus({ clock: systemClock });
    const { embedder, warms } = fakeEmbedder(true);
    const stop = warmEmbedderOnImport(bus, embedder);
    job(bus, 'library.hashAsset', 'running');
    job(bus, 'media.normalise', 'running');
    await settle();
    expect(warms()).toBe(2);
    job(bus, 'library.hashAsset', 'succeeded');
    job(bus, 'vision.embedAsset', 'running');
    await settle();
    expect(warms()).toBe(2);
    stop();
    job(bus, 'library.hashAsset', 'running');
    await settle();
    expect(warms()).toBe(2);
  });

  it('leaves the model to load at the first frame where the profile says so', async () => {
    const bus = createEventBus({ clock: systemClock });
    const { embedder, warms } = fakeEmbedder(false);
    warmEmbedderOnImport(bus, embedder);
    job(bus, 'library.hashAsset', 'running');
    await settle();
    expect(warms()).toBe(0);
  });
});
