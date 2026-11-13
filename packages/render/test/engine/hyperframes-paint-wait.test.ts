// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-FIX, the third-party side: the patched HyperFrames engine (patches/@hyperframes__engine@0.8.209.patch, NOTICE)
 * captures a drawElement frame only from that frame's own paint. Upstream drew after 250 ms without a paint event,
 * from whatever snapshot the canvas last recorded: the frame before, when nothing has painted since the seek.
 *
 * The engine's in-page capture runs here against a stand-in page (no Chrome): its canvas records a snapshot only when
 * the test fires its `paint` event, and `drawElementImage` draws the last one recorded, the html-in-canvas contract
 * the engine's own comments describe. The fake clock is driven past 250 ms before the paint lands.
 */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const producerDir = realpathSync(
  join(import.meta.dirname, '..', '..', 'node_modules', '@hyperframes', 'producer'),
);
const engineDir = realpathSync(join(producerDir, '..', 'engine'));

interface DrawElementService {
  captureDrawElementFrame(
    page: { evaluate: (fn: (args: never) => unknown, args: unknown) => Promise<unknown> },
    width: number,
    height: number,
    format?: string,
    quality?: number,
    syncToPaintEvent?: boolean,
  ): Promise<Buffer>;
  readonly DE_PAINT_WAIT_MS: number;
  readonly DE_PAINT_TIMEOUT_CODE: string;
}

const service = (await import(
  pathToFileURL(join(engineDir, 'dist', 'services', 'drawElementService.js')).href
)) as DrawElementService;

/** A page with the engine's injected canvas: snapshots recorded at paint events only. */
function standInPage(firstSnapshot: string) {
  const listeners = new Set<() => void>();
  let recorded = firstSnapshot;
  let last = '';
  const drawn: string[] = [];
  const ctx = {
    fillStyle: '',
    globalAlpha: 1,
    clearRect: () => undefined,
    fillRect: () => undefined,
    drawImage: () => undefined,
    setTransform: () => undefined,
    drawElementImage: () => {
      last = recorded;
      drawn.push(recorded);
    },
  };
  const canvas = {
    getContext: () => ctx,
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'paint') listeners.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      if (type === 'paint') listeners.delete(fn);
    },
    toDataURL: () => `data:image/jpeg;base64,${Buffer.from(last).toString('base64')}`,
  };
  const root = {
    parentElement: null,
    contains: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  return {
    drawn,
    listening: () => listeners.size,
    /** The frame's paint: the canvas records `snapshot`, then dispatches its paint event. */
    paint(snapshot: string) {
      recorded = snapshot;
      for (const fn of [...listeners]) fn();
    },
    install() {
      vi.stubGlobal('document', {
        getElementById: (id: string) => (id === '__hf_de_canvas' ? canvas : null),
        querySelector: () => root,
      });
      vi.stubGlobal('window', { __hfDeInvalidate: () => true });
    },
    page: { evaluate: (fn: (args: never) => unknown, args: unknown) => Promise.resolve(fn(args as never)) },
  };
}

describe('patched drawElement capture waits for its paint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('draws the frame whose paint lands after 250 ms, not the snapshot before it', async () => {
    const stand = standInPage('frame 41');
    stand.install();
    const capture = service.captureDrawElementFrame(stand.page, 1080, 1920, 'jpeg', 80, true);
    await vi.advanceTimersByTimeAsync(400);
    // Upstream drew frame 41 here, at 250 ms.
    expect(stand.drawn).toEqual([]);
    expect(stand.listening()).toBe(1);
    stand.paint('frame 42');
    await vi.advanceTimersByTimeAsync(1);
    expect((await capture).toString()).toBe('frame 42');
    expect(stand.drawn).toEqual(['frame 42']);
  });

  it('draws a prompt paint straight away', async () => {
    const stand = standInPage('frame 6');
    stand.install();
    const capture = service.captureDrawElementFrame(stand.page, 1080, 1920, 'jpeg', 80, true);
    await vi.advanceTimersByTimeAsync(2);
    stand.paint('frame 7');
    await vi.advanceTimersByTimeAsync(1);
    expect((await capture).toString()).toBe('frame 7');
  });

  it('fails a capture whose paint never comes, recoverably, without drawing', async () => {
    const stand = standInPage('frame 41');
    stand.install();
    const capture = service.captureDrawElementFrame(stand.page, 1080, 1920, 'jpeg', 80, true);
    const settled = capture.then(
      () => 'drawn',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    await vi.advanceTimersByTimeAsync(service.DE_PAINT_WAIT_MS);
    expect(await settled).toContain(service.DE_PAINT_TIMEOUT_CODE);
    expect(stand.drawn).toEqual([]);
    expect(stand.listening()).toBe(0);
  });
});
