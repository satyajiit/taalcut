// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { TimeoutError, type Timeline } from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../src/backend/backend';
import { createTimelineDocuments } from '../src/backend/timeline-documents';
import { seedProjects } from '../src/backend/fake/make/seed';

const timeline = seedProjects().projects.flatMap((project) => project.timelines)[0]!;

function stream() {
  let waiting = Promise.withResolvers<IteratorResult<Timeline>>();
  return {
    push(value: Timeline) {
      waiting.resolve({ value, done: false });
    },
    fail() {
      waiting.reject(TimeoutError({ ms: 100 }));
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        const value = await waiting.promise;
        waiting = Promise.withResolvers<IteratorResult<Timeline>>();
        return value;
      },
    },
  };
}
afterEach(() => vi.useRealTimers());

describe('the authoritative document subscription', () => {
  it('shares one stream, rejects older revisions and disconnects only after the last consumer leaves', async () => {
    const live = stream();
    let signal: AbortSignal | undefined;
    const watch = vi.fn(async (_input, options) => {
      signal = options.signal;
      return live.iterable;
    });
    const documents = createTimelineDocuments({ timelines: { watch } as unknown as Backend['timelines'] });
    const editor = documents.get(timeline.id);
    const card = documents.get(timeline.id);
    const stopEditor = editor.subscribe(() => {});
    const stopCard = card.subscribe(() => {});
    expect(watch).toHaveBeenCalledTimes(1);
    live.push({ ...timeline, revision: 8 });
    await vi.waitFor(() => expect(editor.snapshot().data?.revision).toBe(8));
    expect(card.snapshot()).toBe(editor.snapshot());
    live.push({ ...timeline, revision: 7 });
    await Promise.resolve();
    await Promise.resolve();
    expect(editor.snapshot().data?.revision).toBe(8);
    stopEditor();
    expect(signal?.aborted).toBe(false);
    stopCard();
    expect(signal?.aborted).toBe(true);
  });

  it('keeps stale data on failure, reconnects, and ignores responses from an abandoned stream', async () => {
    vi.useFakeTimers();
    const first = stream();
    const second = stream();
    const third = stream();
    const watch = vi
      .fn()
      .mockResolvedValueOnce(first.iterable)
      .mockResolvedValueOnce(second.iterable)
      .mockResolvedValueOnce(third.iterable);
    const doc = createTimelineDocuments({ timelines: { watch } as unknown as Backend['timelines'] }).get(
      timeline.id,
    );
    const stop = doc.subscribe(() => {});
    first.push({ ...timeline, revision: 2 });
    await vi.advanceTimersByTimeAsync(0);
    first.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(doc.snapshot()).toMatchObject({ status: 'error', stale: true, data: { revision: 2 } });
    await vi.advanceTimersByTimeAsync(250);
    expect(watch).toHaveBeenCalledTimes(2);
    doc.reload();
    third.push({ ...timeline, revision: 4 });
    await vi.advanceTimersByTimeAsync(0);
    second.push({ ...timeline, revision: 99 });
    await vi.advanceTimersByTimeAsync(0);
    expect(doc.snapshot()).toMatchObject({ status: 'ready', data: { revision: 4 } });
    stop();
  });
});
