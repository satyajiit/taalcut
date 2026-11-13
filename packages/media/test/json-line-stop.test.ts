// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-V3, IX3-K2: a sidecar that may hold VideoToolbox sessions is never signalled. `holdsVideoSession: true` ends
 * it by closing its stdin and waiting (until it exits, or the end policy's stall report), and `settleOnReply`
 * holds a cancelled request until the helper answers the cancel (its session invalidated), so a lease held across
 * the request is really free when it returns. IX2-F4: when the grace runs out first, `onLetGo` still waits for the
 * helper's late answer or its exit, and nothing signals it. A helper that holds nothing keeps SIGTERM, then SIGKILL.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEndPolicy,
  createJsonLineSidecar,
  MediaCancelled,
  MediaTimeout,
  type ProcessStall,
} from '@taalcut/media';

const fakeHelper = fileURLToPath(new URL('./fixtures/fake-mac-helper.mjs', import.meta.url));

describe('a sidecar stopped by stdin', () => {
  let dir: string;
  let mark: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-stop-'));
    mark = join(dir, 'mark.txt');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const notes = () =>
    readFile(mark, 'utf8').then(
      (text) => text.trim().split('\n'),
      () => [],
    );

  it('closes by ending stdin and waits for the helper to exit, however long it takes', async () => {
    const sidecar = createJsonLineSidecar({
      command: process.execPath,
      args: [fakeHelper, '--mark', mark, '--linger', '1500'],
      holdsVideoSession: true,
    });
    expect((await sidecar.ready()).ok).toBe(true);
    const started = Date.now();
    await sidecar.close();
    // Past the signalling client's one-second SIGKILL: this one never signals.
    expect(Date.now() - started).toBeGreaterThanOrEqual(1400);
    expect(await notes()).toEqual(['eof']);
  });

  it('never signals a stuck video-session helper: closes on the stall report and leaves it running', async () => {
    const stalls: ProcessStall[] = [];
    const sidecar = createJsonLineSidecar({
      command: process.execPath,
      args: [fakeHelper, '--mark', mark, '--stuck'],
      holdsVideoSession: true,
      endPolicy: createEndPolicy({ stallAfterMs: 400, onStall: (stall) => stalls.push(stall) }),
    });
    expect((await sidecar.ready()).ok).toBe(true);
    const started = Date.now();
    await sidecar.close();
    // Never before the release point, two of close()'s one-second graces.
    expect(Date.now() - started).toBeGreaterThanOrEqual(1950);
    expect(stalls).toEqual([
      expect.objectContaining({ command: process.execPath, reason: 'closed', afterMs: 2000 }),
    ]);
    const pid = stalls[0]?.pid ?? 0;
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      // Long past the signalling client's one-second SIGKILL: still alive, and it saw no signal.
      expect(() => process.kill(pid, 0)).not.toThrow();
      expect(await notes()).toEqual(['eof']);
    } finally {
      // A plain Node stand-in: the test may end it.
      process.kill(pid, 'SIGKILL');
    }
  });

  it('ends a video-session helper it gave up on by its stdin, without a signal', async () => {
    const sidecar = createJsonLineSidecar({
      command: process.execPath,
      args: [fakeHelper, '--mark', mark],
      holdsVideoSession: true,
      maxLineBytes: 1024,
    });
    expect((await sidecar.ready()).ok).toBe(true);
    const huge = await sidecar.request('huge', {});
    expect(huge.ok).toBe(false);
    await vi.waitFor(async () => expect(await notes()).toEqual(['eof']), { timeout: 2000 });
    await sidecar.close();
  });

  it('kills a helper that holds nothing, it gave up on', async () => {
    const sidecar = createJsonLineSidecar({
      command: process.execPath,
      args: [fakeHelper, '--mark', mark, '--stuck'],
      maxLineBytes: 1024,
    });
    const ready = await sidecar.ready();
    expect(ready.ok).toBe(true);
    const huge = await sidecar.request('huge', {});
    expect(huge.ok).toBe(false);
    // SIGTERM and SIGKILL at once (no grace): the stand-in, which survives SIGTERM, is gone.
    const pid = ready.ok ? Number((ready.value as { pid?: number }).pid) : 0;
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 2000 });
    await sidecar.close();
  });

  it('a signalling client terminates the helper', async () => {
    const sidecar = createJsonLineSidecar({ command: process.execPath, args: [fakeHelper, '--mark', mark] });
    expect((await sidecar.ready()).ok).toBe(true);
    await sidecar.close();
    expect(await notes()).toEqual(['sigterm']);
  });

  it('settles a cancelled request on the helper reply, and a timed-out one too', async () => {
    const sidecar = createJsonLineSidecar({
      command: process.execPath,
      args: [fakeHelper],
      holdsVideoSession: true,
    });
    const abort = new AbortController();
    const started = Date.now();
    const request = sidecar.request('slow', {}, { signal: abort.signal, settleOnReply: true });
    await sidecar.ready();
    setTimeout(() => abort.abort(), 20);
    const cancelled = await request;
    expect(!cancelled.ok && MediaCancelled.is(cancelled.error)).toBe(true);
    // The fake answers a cancel 150 ms after it arrives.
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    const timed = await sidecar.request('slow', {}, { timeoutMs: 30, settleOnReply: true });
    expect(!timed.ok && MediaTimeout.is(timed.error)).toBe(true);
    // The process is still the same one: requests after a cancel go to it.
    expect((await sidecar.request('ocr.languages', {})).ok).toBe(true);
    await sidecar.close();
  });

  it('settles after the grace when the helper never answers the cancel, and leaves the process alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sidecar = createJsonLineSidecar({
      command: process.execPath,
      args: [fakeHelper, '--mark', mark],
      holdsVideoSession: true,
    });
    await sidecar.ready();
    const abort = new AbortController();
    const request = sidecar.request(
      'mute',
      {},
      { signal: abort.signal, settleOnReply: true, replyGraceMs: 80 },
    );
    setTimeout(() => abort.abort(), 20);
    const cancelled = await request;
    expect(!cancelled.ok && MediaCancelled.is(cancelled.error)).toBe(true);
    expect(warn.mock.calls.some(([line]) => String(line).includes('no answer to a cancel'))).toBe(true);
    expect((await sidecar.request('ocr.languages', {})).ok).toBe(true);
    await sidecar.close();
    expect(await notes()).toEqual(['eof']);
    warn.mockRestore();
  });

  it('settles a cancelled request at once without settleOnReply', async () => {
    const sidecar = createJsonLineSidecar({ command: process.execPath, args: [fakeHelper] });
    await sidecar.ready();
    const abort = new AbortController();
    const request = sidecar.request('slow', {}, { signal: abort.signal });
    const started = Date.now();
    abort.abort();
    const cancelled = await request;
    expect(!cancelled.ok && MediaCancelled.is(cancelled.error)).toBe(true);
    expect(Date.now() - started).toBeLessThan(150);
    await sidecar.close();
  });

  describe('onLetGo', () => {
    it('runs at the reply, and at once for a request never sent', async () => {
      const sidecar = createJsonLineSidecar({
        command: process.execPath,
        args: [fakeHelper],
        holdsVideoSession: true,
      });
      let letGo = 0;
      expect((await sidecar.request('ocr.languages', {}, { onLetGo: () => letGo++ })).ok).toBe(true);
      expect(letGo).toBe(1);
      const aborted = new AbortController();
      aborted.abort();
      await sidecar.request('ocr.languages', {}, { signal: aborted.signal, onLetGo: () => letGo++ });
      expect(letGo).toBe(2);
      await sidecar.close();
    });

    it('waits past the grace for the helper’s late answer to the cancel', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sidecar = createJsonLineSidecar({
        command: process.execPath,
        args: [fakeHelper],
        holdsVideoSession: true,
      });
      await sidecar.ready();
      const abort = new AbortController();
      let letGo = 0;
      const request = sidecar.request(
        'slow',
        {},
        { signal: abort.signal, settleOnReply: true, replyGraceMs: 40, onLetGo: () => letGo++ },
      );
      setTimeout(() => abort.abort(), 10);
      const cancelled = await request;
      expect(!cancelled.ok && MediaCancelled.is(cancelled.error)).toBe(true);
      expect(letGo).toBe(0);
      expect(
        warn.mock.calls.some(([line]) => String(line).includes('stays held until it answers or exits')),
      ).toBe(true);
      // The fake answers a cancel 150 ms after it arrives.
      await vi.waitFor(() => expect(letGo).toBe(1), { timeout: 2000 });
      expect((await sidecar.request('ocr.languages', {})).ok).toBe(true);
      await sidecar.close();
      expect(letGo).toBe(1);
      warn.mockRestore();
    });

    it('holds a request the helper never answers until the helper exits, without a signal', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sidecar = createJsonLineSidecar({
        command: process.execPath,
        args: [fakeHelper, '--mark', mark],
        holdsVideoSession: true,
      });
      await sidecar.ready();
      const abort = new AbortController();
      let letGo = 0;
      const request = sidecar.request(
        'mute',
        {},
        { signal: abort.signal, settleOnReply: true, replyGraceMs: 40, onLetGo: () => letGo++ },
      );
      setTimeout(() => abort.abort(), 10);
      expect((await request).ok).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(letGo).toBe(0);
      await sidecar.close();
      expect(letGo).toBe(1);
      expect(await notes()).toEqual(['eof']);
      warn.mockRestore();
    });
  });
});
