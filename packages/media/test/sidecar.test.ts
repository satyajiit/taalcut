// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MediaCancelled,
  MediaTimeout,
  SidecarFailed,
  SidecarNotFound,
  SidecarPinMismatch,
  SidecarRejected,
  StillUnreadable,
  createJsonLineSidecar,
  createMacHelperStillReader,
  createSidecarResolver,
  stillFromProbe,
} from '@taalcut/media';
import { signatureFreeSha256 } from '../src/binaries/macho-digest';
import { probeOf, videoStream } from './helpers/probe-fixture';

const fakeHelper = fileURLToPath(new URL('./fixtures/fake-mac-helper.mjs', import.meta.url));
const sidecars: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(sidecars.splice(0).map((sidecar) => sidecar.close()));
});

function open(args: string[] = [], idleExitMs?: number) {
  const sidecar = createJsonLineSidecar({
    command: process.execPath,
    args: [fakeHelper, ...args],
    ...(idleExitMs === undefined ? {} : { idleExitMs }),
  });
  sidecars.push(sidecar);
  return sidecar;
}

describe('json-line sidecar', () => {
  it('reads the ready line and a successful request', async () => {
    const sidecar = open();
    const ready = await sidecar.ready();
    expect(ready.ok && ready.value).toMatchObject({ type: 'ready', protocol: 1 });
    const languages = await sidecar.request('ocr.languages', {});
    expect(languages.ok && languages.value).toEqual({ accurate: ['en', 'es', 'pt'] });
  });

  it('matches an earlier request after a later one', async () => {
    const sidecar = open();
    const held = sidecar.request('hold', {});
    const released = await sidecar.request('release', {});
    expect(released.ok && released.value).toEqual({ released: true });
    const heldResult = await held;
    expect(heldResult.ok && heldResult.value).toEqual({ held: true });
  });

  it('rejects an oversized line and can start again', async () => {
    const sidecar = createJsonLineSidecar({
      command: process.execPath,
      args: [fakeHelper],
      maxLineBytes: 512,
    });
    sidecars.push(sidecar);
    const huge = await sidecar.request('huge', {});
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(SidecarFailed.is(huge.error)).toBe(true);
    const languages = await sidecar.request('ocr.languages', {});
    expect(languages.ok).toBe(true);
  });

  it('appends idle-exit seconds once', async () => {
    const sidecar = open(['--idle-exit', '9'], 2500);
    const ready = await sidecar.ready();
    expect(ready.ok && ready.value).toMatchObject({ argv: [fakeHelper, '--idle-exit', '9'] });
    const again = open([], 2500);
    const second = await again.ready();
    expect(second.ok && second.value).toMatchObject({ argv: [fakeHelper, '--idle-exit', '3'] });
  });

  it('maps helper errors and forwards progress', async () => {
    const sidecar = open();
    const rejected = await sidecar.request('nope', {});
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(SidecarRejected.is(rejected.error)).toBe(true);
    const retry = await sidecar.request('retry', {});
    expect(retry.ok).toBe(false);
    if (!retry.ok) {
      expect(SidecarFailed.is(retry.error)).toBe(true);
      expect(retry.error.params).toMatchObject({ helperCode: 'ocr.failed' });
    }
    const notes: number[] = [];
    const progressed = await sidecar.request(
      'progress',
      {},
      { onNotification: (message) => notes.push(message.fraction ?? 0) },
    );
    expect(progressed.ok && progressed.value).toEqual({ text: 'done' });
    expect(notes).toEqual([0.5]);
  });

  it('cancels one request without killing the process', async () => {
    const sidecar = open();
    const controller = new AbortController();
    const hanging = sidecar.request('hang', {}, { signal: controller.signal });
    controller.abort();
    const cancelled = await hanging;
    expect(cancelled.ok).toBe(false);
    if (!cancelled.ok) expect(MediaCancelled.is(cancelled.error)).toBe(true);
    const languages = await sidecar.request('ocr.languages', {});
    expect(languages.ok).toBe(true);
  });

  it('times out and restarts after a crash', async () => {
    const sidecar = open();
    const timed = await sidecar.request('hang', {}, { timeoutMs: 30 });
    expect(timed.ok).toBe(false);
    if (!timed.ok) expect(MediaTimeout.is(timed.error)).toBe(true);
    const crashed = await sidecar.request('boom', {});
    expect(crashed.ok).toBe(false);
    if (!crashed.ok) expect(SidecarFailed.is(crashed.error)).toBe(true);
    const languages = await sidecar.request('ocr.languages', {});
    expect(languages.ok).toBe(true);
  });

  it('waits out a helper that beats past the stall wait, and gives up on one that goes quiet (FIX-OCRCOLD)', async () => {
    const sidecar = open();
    const beats: string[] = [];
    const answered = await sidecar.request(
      'beat',
      { every: 20, for: 400 },
      { stallTimeoutMs: 120, timeoutMs: 5000, onNotification: (m) => beats.push(String(m.type)) },
    );
    expect(answered.ok && answered.value).toEqual({ beats: true });
    expect(beats.length).toBeGreaterThan(5);
    const started = performance.now();
    const quiet = await sidecar.request(
      'beat',
      { every: 20, for: 100, quiet: true },
      { stallTimeoutMs: 150, timeoutMs: 5000 },
    );
    expect(quiet.ok).toBe(false);
    if (!quiet.ok) {
      expect(MediaTimeout.is(quiet.error)).toBe(true);
      expect(quiet.error.detail).toContain('said nothing about beat');
    }
    // About the 100 ms of beats plus the 150 ms stall, far from the cap.
    expect(performance.now() - started).toBeLessThan(2000);
    const capped = await sidecar.request(
      'beat',
      { every: 20, for: 3000 },
      { stallTimeoutMs: 150, timeoutMs: 300 },
    );
    expect(!capped.ok && MediaTimeout.is(capped.error) && capped.error.params?.['ms']).toBe(300);
    // The process lives on.
    expect((await sidecar.request('ocr.languages', {})).ok).toBe(true);
  });

  it('reports a missing binary', async () => {
    const sidecar = createJsonLineSidecar({ command: '/no/such/taalcut-mac-helper' });
    sidecars.push(sidecar);
    const ready = await sidecar.ready();
    expect(ready.ok).toBe(false);
    if (!ready.ok) expect(SidecarNotFound.is(ready.error)).toBe(true);
  });
});

describe('still readers', () => {
  it('reads helper metadata and maps an unreadable still', async () => {
    const sidecar = open();
    const reader = createMacHelperStillReader(sidecar);
    const read = await reader.read('/tmp/frame.jpg');
    expect(read.ok && read.value).toMatchObject({
      width: 640,
      height: 360,
      orientation: 6,
      contentIdentifier: 'LIVE',
      hasGainMap: false,
    });
    const missing = await reader.read('missing');
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(StillUnreadable.is(missing.error)).toBe(true);
  });

  it('maps probe rotation and leaves the maker note empty', () => {
    const portrait = stillFromProbe(
      probeOf('/tmp/clip.mov', videoStream({ displayWidth: 1080, displayHeight: 1920, rotation: 90 })),
    );
    expect(portrait.ok && portrait.value).toMatchObject({
      width: 1080,
      height: 1920,
      orientation: 6,
      hasGainMap: false,
    });
    expect(portrait.ok && portrait.value.contentIdentifier).toBeUndefined();
    const turned = stillFromProbe(probeOf('/tmp/a.mov', videoStream({ rotation: 180 })));
    expect(turned.ok && turned.value.orientation).toBe(3);
    const other = stillFromProbe(probeOf('/tmp/b.mov', videoStream({ rotation: 270 })));
    expect(other.ok && other.value.orientation).toBe(8);
    const none = stillFromProbe(probeOf('/tmp/audio.m4a', null));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(StillUnreadable.is(none.error)).toBe(true);
  });
});

describe('sidecar resolver', () => {
  it('pins an override, refuses a bad pin, and does not fall through a sidecar directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'taalcut-helper-'));
    try {
      const binary = join(root, 'taalcut-mac-helper');
      writeFileSync(binary, 'not a macho');
      chmodSync(binary, 0o755);
      const pin = await signatureFreeSha256(binary);
      const matched = await createSidecarResolver({
        name: 'taalcut-mac-helper',
        pin,
        development: true,
        env: { TAALCUT_MAC_HELPER: binary },
        devDist: join(root, 'missing'),
      }).resolve();
      expect(matched.ok && matched.value.source).toBe('env');
      const wrong = await createSidecarResolver({
        name: 'taalcut-mac-helper',
        pin: '0'.repeat(64),
        development: true,
        env: { TAALCUT_MAC_HELPER: binary },
      }).resolve();
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) expect(SidecarPinMismatch.is(wrong.error)).toBe(true);
      const absent = await createSidecarResolver({
        name: 'taalcut-mac-helper',
        sidecarDir: join(root, 'empty'),
        development: true,
        devDist: root,
      }).resolve();
      expect(absent.ok).toBe(false);
      if (!absent.ok) expect(SidecarNotFound.is(absent.error)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs a sidecar directory's helper only with its pin: none, or a swapped helper, is refused", async () => {
    const root = mkdtempSync(join(tmpdir(), 'taalcut-helper-'));
    try {
      const bin = join(root, 'Resources', 'bin');
      const binary = join(bin, 'taalcut-mac-helper');
      mkdirSync(bin, { recursive: true });
      writeFileSync(binary, 'the helper packaging pinned');
      chmodSync(binary, 0o755);
      const pin = await signatureFreeSha256(binary);
      const packaged = (pinned: string) =>
        createSidecarResolver({
          name: 'taalcut-mac-helper',
          sidecarDir: bin,
          pin: pinned,
          env: {},
        }).resolve();
      const shipped = await packaged(pin);
      expect(shipped.ok && shipped.value).toEqual({ path: binary, source: 'sidecar' });
      const unpinned = await packaged('');
      expect(unpinned.ok).toBe(false);
      if (!unpinned.ok) {
        expect(SidecarPinMismatch.is(unpinned.error)).toBe(true);
        expect(unpinned.error.detail).toBe(`${binary}: no pin to check it against, so it is not run`);
      }
      writeFileSync(binary, 'another helper');
      const swapped = await packaged(pin);
      expect(swapped.ok).toBe(false);
      if (!swapped.ok) {
        expect(SidecarPinMismatch.is(swapped.error)).toBe(true);
        expect(swapped.error.detail).toBe(`${binary}: ${await signatureFreeSha256(binary)}`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
