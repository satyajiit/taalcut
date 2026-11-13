// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createManualClock, newId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createRunFeed } from '../../src/usb/run-feed';
import type { RunRecord } from '../../src/usb/run-store';

function fixture() {
  const clock = createManualClock(0);
  const run: RunRecord = {
    id: newId<'DeviceImportRun'>(),
    deviceKey: 'AAAAAAAAAAAAAAAA',
    deviceLabel: 'Phone',
    platform: 'ios',
    sessionId: newId<'TransferSession'>(),
    bridge: 'image-capture',
    state: 'running',
    sourceId: null,
    startedAt: 0,
    updatedAt: 0,
    items: [],
    totals: {
      items: 1,
      bytes: 1000,
      done: 0,
      bytesDone: 0,
      imported: 0,
      duplicates: 0,
      inICloud: 0,
      rejected: 0,
      failed: 0,
      converted: 0,
    },
  };
  const feed = createRunFeed({
    clock,
    get: () => run,
    inflight: () => 0,
    changed: () => undefined,
    schedule: () => ({ cancel: () => undefined }),
  });
  return { run, clock, feed };
}
describe('USB measured throughput', () => {
  it('starts with unknown ETA and excludes a long pause from resumed speed', () => {
    const { run, clock, feed } = fixture();
    expect(feed.present(run).etaMs).toBeUndefined();
    clock.advance(1000);
    run.totals = { ...run.totals, bytesDone: 100 };
    expect(feed.present(run).bytesPerSecond).toBe(100);
    run.state = 'paused';
    feed.present(run);
    clock.advance(1_000_000);
    run.state = 'running';
    expect(feed.present(run).bytesPerSecond).toBeUndefined();
    clock.advance(1000);
    run.totals = { ...run.totals, bytesDone: 200 };
    expect(feed.present(run).bytesPerSecond).toBe(100);
  });
  it('does not turn an unsupported zero speed into a zero-second ETA', () => {
    const { run, clock, feed } = fixture();
    feed.present(run);
    clock.advance(1000);
    expect(feed.present(run)).toMatchObject({ bytesPerSecond: 0 });
    expect(feed.present(run).etaMs).toBeUndefined();
  });
});
