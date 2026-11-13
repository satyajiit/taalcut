// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * 1,000 fake-iPhone items: hash and probe match, a cable pull at item 400 resumes,
 * a hung import at item 700 is stopped and finished by a new service, and Only new imports nothing.
 * The import's probes are answered from the catalogue (import-1000-media.ts: what ffprobe says of each file's
 * template), and checked against ffprobe on one file of each kind and three Live Photo videos: a real ffprobe
 * per item made the test a measure of how fast this Mac starts processes (UX2 round 2).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBLAKE3 } from 'hash-wasm';
import { afterEach, describe, expect, inject, it } from 'vitest';
import { ok, type AssetId } from '@taalcut/core';
import { createMediaService, type ProbeResult, type ResolvedFfmpeg } from '@taalcut/media';
import { testFfmpegFor } from '@taalcut/media/test-support';
import type { TransferMedia } from '../../src/deps';
import type { DeviceItem } from '../../src/usb/bridge';
import { createFakePhone, type FakePhone } from './fake-phone';
import { buildCatalogue, isProbe, type Catalogue, type Role } from './import-1000-media';
import { connectPhone, createCopySink, createHarness, firstView, untilTerminal } from './import-harness';

// The run's FFmpeg, checked once before any file started (media's test-support-ffmpeg.ts).
const { binaries } = testFfmpegFor(inject('testFfmpeg'), 'fake iPhone import of 1,000 items');

const dirs: string[] = [];
const selection = { filter: { onlyNew: true, timeZone: 'UTC' }, include: [], exclude: [] };

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe.skipIf(!binaries)('fake iPhone import of 1,000 items', () => {
  it('keeps originals, resumes a cable pull, and continues after the process stops', async () => {
    if (!binaries) throw new Error('the suite ran without FFmpeg');
    const root = await mkdtemp(join(tmpdir(), 'usb-1000-'));
    dirs.push(root);
    const real = realProbe(binaries);
    const catalogue = await buildCatalogue(join(root, 'generated'), binaries.ffmpeg, real);
    const { files } = catalogue;
    const media = catalogueMedia(catalogue, real);
    expect(files).toHaveLength(1000);
    const hashes = new Set(files.map((file) => createHash('sha256').update(file.bytes).digest('hex')));
    expect(hashes.size).toBe(1000);

    const staging = join(root, 'staging');
    const originals = join(root, 'originals');
    const state = join(root, 'state');
    await mkdir(staging);
    await mkdir(originals);
    const known = new Set<AssetId>();
    let hungName = '';
    let sawPause = false;
    const release = new AbortController();
    let phone: FakePhone | null = null;
    phone = createFakePhone(files, {
      onPull: async (_itemId, pullIndex) => {
        if (pullIndex !== 400 || !phone) return 'ok';
        phone.unplug();
        for (let turn = 0; turn < 8; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
        return 'gone';
      },
    });
    const copy = createCopySink(staging, originals, known, {
      hangAt: 700,
      onHang: (fileName) => {
        hungName = fileName;
      },
    });
    const service = createHarness(state, copy.sink, media, phone);
    const key = await connectPhone(service, phone, release.signal);
    const opened = await service.openDevice(key, release.signal);
    expect(opened.ok).toBe(true);
    const started = await service.importFromDevice({ deviceKey: key, selection }, release.signal);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const runId = started.value.runId;
    const watching = watchPause(service, phone, runId, release.signal, () => {
      sawPause = true;
    });
    const hung = waitFor(() => hungName.length > 0);
    await hung;
    expect(sawPause).toBe(true);
    const doneBefore = new Set(await readdir(originals));
    expect(doneBefore.size).toBe(699);
    expect(doneBefore.has(hungName)).toBe(false);
    // 700 imports reached the sink (the 700th hangs), each a different item: the cable pull at
    // item 400 did not import anything twice.
    expect(copy.imports()).toBe(700);
    expect(new Set(copy.names()).size).toBe(700);
    // The process stops: SIGTERM closes its runs (their last save lands) and main starts the next lan process
    // only once this one has exited (transfer SPEC, "Crash or quit").
    await service.close();

    const phone2 = createFakePhone(files);
    const copy2 = createCopySink(staging, originals, known);
    const service2 = createHarness(state, copy2.sink, media, phone2);
    const life2 = new AbortController();
    try {
      await connectPhone(service2, phone2, life2.signal);
      // A new process offers to carry on (transfer SPEC, "Crash or quit"); nothing moves until asked.
      const offered = await firstView(service2, runId, life2.signal);
      expect(offered.state).toBe('paused');
      expect(offered.pauseReason).toBe('person');
      expect(phone2.pulls()).toHaveLength(0);
      const resumed = await service2.resumeDeviceImport(runId);
      expect(resumed.ok).toBe(true);
      const finished = await untilTerminal(service2, runId, life2.signal);
      expect(finished.state).toBe('succeeded');
      expect(finished.totals.imported).toBe(1000);
      expect(finished.totals.failed).toBe(0);
      expect(phone2.pulls()).toHaveLength(300);
      expect(phone2.pulls().includes(hungName)).toBe(false);
      for (const name of doneBefore) expect(phone2.pulls().includes(name)).toBe(false);

      const again = await service2.importFromDevice({ deviceKey: key, selection }, life2.signal);
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      const second = await untilTerminal(service2, again.value.runId, life2.signal);
      expect(second.state).toBe('succeeded');
      expect(second.totals.imported).toBe(0);
      expect(second.totals.items).toBe(0);
      expect(copy2.imports()).toBe(301);
      // The second process imported the hung item and the 300 never pulled, and nothing the first had.
      const before = new Set(copy.names());
      expect(copy2.names().filter((name) => before.has(name))).toEqual([hungName]);

      await checkOriginals(catalogue, originals, real);
    } finally {
      life2.abort();
      release.abort();
      await watching;
    }
  }, 300_000);
});

function watchPause(
  service: ReturnType<typeof createHarness>,
  phone: FakePhone,
  runId: Parameters<typeof untilTerminal>[1],
  signal: AbortSignal,
  onPause: () => void,
): Promise<void> {
  const job = (async (): Promise<void> => {
    for await (const view of service.deviceRun(runId, signal)) {
      if (view.state !== 'paused' || view.pauseReason !== 'device-gone') continue;
      onPause();
      // Let the in-flight pull finish parking while the phone is still gone.
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      if (!signal.aborted) phone.plug();
      return;
    }
  })();
  return job.then(
    () => undefined,
    () => undefined,
  );
}

function waitFor(ready: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (!ready()) return;
      clearInterval(timer);
      resolve();
    }, 20);
    setTimeout(() => {
      clearInterval(timer);
      reject(new Error('import did not reach item 700'));
    }, 240_000).unref();
  });
}

/** Every original is its file, byte for byte; what was probed of it matches its listing, and is what ffprobe says. */
async function checkOriginals(
  catalogue: Catalogue,
  originals: string,
  real: TransferMedia['probe'],
): Promise<void> {
  const sampled = new Set<Role>();
  let liveVideos = 0;
  for (const file of catalogue.files) {
    // As ffprobe names it: symlinks resolved (/var is /private/var).
    const path = await realpath(join(originals, file.item.name));
    const onDisk = await readFile(path);
    expect(Buffer.compare(onDisk, file.bytes)).toBe(0);
    expect(await blake3(onDisk)).toBe(await blake3(file.bytes));
    const result = catalogue.probeOf(path, onDisk);
    if (!result?.video) throw new Error(`no probe for ${file.item.name}`);
    expectListing(file.item, result);
    // ffprobe on the file itself says the same: one of each kind, and three Live Photo videos (each its group).
    const role = catalogue.roles.get(file.item.name);
    if (!role || (sampled.has(role) && (role !== 'live-mov' || liveVideos >= 3))) continue;
    sampled.add(role);
    if (role === 'live-mov') liveVideos += 1;
    const probed = await real(path);
    if (!isProbe(probed)) throw new Error(`ffprobe failed for ${file.item.name}`);
    expect(probed).toEqual(result);
  }
  expect([...sampled].sort()).toEqual([
    'h264',
    'heic',
    'hevc',
    'jpeg',
    'live-mov',
    'live-still',
    'prores',
    'slow',
  ]);
  expect(liveVideos).toBe(3);
}

function expectListing(item: DeviceItem, result: ProbeResult): void {
  if (!result.video) throw new Error(`no video stream for ${item.name}`);
  expect(result.video.width).toBe(item.width);
  expect(result.video.height).toBe(item.height);
  expectDuration(item, result);
  if (item.flags.prores) expect(result.video.codec ?? '').toContain('prores');
  if (item.type?.includes('hevc')) expect(result.video.codec).toBe('hevc');
  if (item.flags.highFrameRate && result.video.frameRate && result.video.frameRate.den !== 0) {
    expect(result.video.frameRate.num / result.video.frameRate.den).toBeGreaterThan(100);
  }
  if (item.kind === 'video' && item.flags.livePhotoGroup) {
    expect(result.phone?.livePhotoId).toBe(item.flags.livePhotoGroup);
  }
}

function expectDuration(item: DeviceItem, result: ProbeResult): void {
  if (item.durationMs === null || !result.duration || result.duration.rate === 0) return;
  const ms = Math.round((result.duration.value / result.duration.rate) * 1000);
  expect(Math.abs(ms - item.durationMs)).toBeLessThanOrEqual(40);
}

async function blake3(bytes: Buffer): Promise<string> {
  const hasher = await createBLAKE3();
  hasher.update(bytes);
  return hasher.digest('hex');
}

/** ffprobe through media's service, on the run's checked FFmpeg. */
function realProbe(found: ResolvedFfmpeg): TransferMedia['probe'] {
  const service = createMediaService({ resolver: { resolve: async () => ok(found) } });
  return async (path, options) => {
    const probed = await service.probe(path, options?.signal ? { signal: options.signal } : {});
    return probed.ok ? probed.value : { ok: false as const, error: probed.error };
  };
}

/** The import's media: a file the catalogue made is answered from it, anything else goes to ffprobe. */
function catalogueMedia(catalogue: Catalogue, real: TransferMedia['probe']): TransferMedia {
  return {
    async probe(path, options) {
      const known = catalogue.probeOf(await realpath(path), await readFile(path));
      return known ?? real(path, options);
    },
  };
}
