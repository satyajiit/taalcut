// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Phase 3's telemetry events and the USB devices contract (round P3-1): the launch events, the changed import and
 * cost events (an outbox row written before them still sends), the window's own events, the device events, the
 * device procedures, the adb key from main and a USB item in the staging journal.
 */
import { describe, expect, it } from 'vitest';
import {
  createEventBus,
  createManualClock,
  deviceKeysContract,
  devicesStateSchema,
  newId,
  RENDERER_TELEMETRY_EVENTS,
  sizeBucket,
  stagedImportSchema,
  taalcutEventSchema,
  telemetryContract,
  telemetryEventSchema,
  transferContract,
  type DeviceRun,
  type DeviceView,
} from '@taalcut/core';
import { SHA, T0 } from './helpers/documents';
import { inputOf, outputOf } from './helpers/phase3';

const deviceKey = 'ABCDEFGHIJKLMNOP';
const itemKey = 'QRSTUVWXYZ234567';
const runId = newId<'DeviceImportRun'>();
const view: DeviceView = {
  key: deviceKey,
  label: 'Mira’s iPhone',
  platform: 'ios',
  bridge: 'image-capture',
  access: 'ready',
  iCloudPhotos: true,
  items: 1_200,
  connected: true,
};
const totals = {
  items: 10,
  bytes: 1_000,
  done: 4,
  bytesDone: 400,
  imported: 3,
  duplicates: 1,
  inICloud: 0,
  rejected: 0,
  failed: 0,
  converted: 0,
};
const run: DeviceRun = {
  id: runId,
  deviceKey,
  deviceLabel: 'Mira’s iPhone',
  sourceId: null,
  state: 'running',
  totals,
  startedAt: T0,
  updatedAt: T0,
};

describe('launch telemetry', () => {
  it('records Phase 3 events with enums and numbers only', () => {
    const events = [
      { name: 'onboarding.branch', step: 'sources', branch: 'cable' },
      { name: 'onboarding.firstExport', ms: 60_000, start: 'template' },
      { name: 'update.installed', from: '0.3.0', to: '0.3.1-beta.1', channel: 'beta', delta: true },
      { name: 'update.rolledBack', from: '0.3.1', to: '0.3.0', reason: 'hung' },
      { name: 'mcp.sessionCreated', client: 'codex', level: 'read' },
      { name: 'rateLimit.met', module: 'agent', reason: 'quota', outcome: 'stopped' },
      {
        name: 'router.decision',
        mode: 'shadow',
        agree: true,
        routerNone: false,
        mainNone: false,
        confidence: 'high',
        outcome: 'answered',
      },
      { name: 'render.finished', kind: 'export', status: 'needsAttention' },
      { name: 'recipe.used', category: 'captions' },
      { name: 'hub.rated' },
      { name: 'hub.reported', reason: 'spam' },
      { name: 'variants.made', count: 3, axes: ['hook', 'music'] },
      { name: 'interchange.exported', format: 'fcpxml' },
      { name: 'cleanup.applied', fillers: sizeBucket(14), pauses: sizeBucket(9), retakes: sizeBucket(0) },
    ];
    for (const event of events) expect(telemetryEventSchema.parse(event)).toEqual(event);
    expect(
      telemetryEventSchema.safeParse({
        name: 'update.installed',
        from: 'v3',
        to: '0.3.1',
        channel: 'beta',
        delta: true,
      }).success,
    ).toBe(false);
    expect(
      telemetryEventSchema.safeParse({ name: 'hub.shared', slots: 3, withStyle: false, handle: 'mira' })
        .success,
    ).toBe(false);
    expect(telemetryEventSchema.safeParse({ name: 'variants.made', count: 6, axes: [] }).success).toBe(false);
  });

  it('counts USB imports and how calls were paid, and still sends Phase 2 rows', () => {
    const imported = {
      name: 'import.completed',
      source: 'usb',
      assets: '6-20',
      failed: '0',
      reencodedByPhone: '0',
      ms: 9,
    };
    expect(telemetryEventSchema.parse({ ...imported, bridge: 'adb', inICloud: '1' })).toMatchObject({
      bridge: 'adb',
    });
    expect(telemetryEventSchema.parse({ ...imported, source: 'wifi' })).toEqual({
      ...imported,
      source: 'wifi',
    });
    const cost = {
      name: 'cost.recorded',
      scope: 'export',
      usdMicros: 1,
      estimateMicros: 1,
      byModule: {},
      capHit: false,
    };
    expect(telemetryEventSchema.parse(cost)).toEqual(cost);
    expect(telemetryEventSchema.parse({ ...cost, billing: 'apiKey' })).toMatchObject({ billing: 'apiKey' });
    expect(telemetryEventSchema.safeParse({ ...cost, billing: 'card' }).success).toBe(false);
  });

  it('lets a window record onboarding and recipe events, and nothing of another process', () => {
    expect(RENDERER_TELEMETRY_EVENTS).toEqual(expect.arrayContaining(['onboarding.branch', 'recipe.used']));
    expect(
      inputOf(telemetryContract.record, { event: { name: 'recipe.used', category: 'music' } }).success,
    ).toBe(true);
    const fromWindow = { event: { name: 'render.finished', kind: 'draft', status: 'ready' } };
    expect(inputOf(telemetryContract.record, fromWindow).success).toBe(false);
  });
});

describe('USB devices', () => {
  it('announces devices and runs as events', () => {
    const bus = createEventBus({ clock: createManualClock(5) });
    const seen: unknown[] = [];
    bus.onAny((event) => seen.push(taalcutEventSchema.parse(event)));
    bus.emit('transfer.device', view);
    bus.emit('transfer.deviceRun', { ...run, state: 'paused', pauseReason: 'locked' });
    expect(seen).toEqual([
      { type: 'transfer.device', at: 5, payload: view },
      { type: 'transfer.deviceRun', at: 5, payload: { ...run, state: 'paused', pauseReason: 'locked' } },
    ]);
    expect(devicesStateSchema.parse({ devices: [view], runs: [run] }).devices).toHaveLength(1);
    expect(devicesStateSchema.safeParse({ devices: [{ ...view, key: 'abc' }], runs: [] }).success).toBe(
      false,
    );
  });

  it('browses a device by filter and imports a selection', () => {
    const filter = { from: '2026-10-01', kinds: ['video', 'live'], timeZone: 'Asia/Kolkata' };
    const items = inputOf(transferContract.deviceItems, { deviceKey, filter });
    expect(items.success && items.data).toMatchObject({ limit: 200, filter: { onlyNew: true } });
    expect(
      inputOf(transferContract.deviceItems, { deviceKey, filter: { ...filter, from: '1/10/2026' } }).success,
    ).toBe(false);
    const selection = inputOf(transferContract.importFromDevice, {
      deviceKey,
      selection: { filter, include: [itemKey] },
    });
    expect(selection.success && selection.data).toMatchObject({
      selection: { include: [itemKey], exclude: [] },
    });
    const page = {
      items: [
        {
          key: itemKey,
          name: 'IMG_0418.MOV',
          kind: 'video',
          sizeBytes: 100,
          createdAt: T0,
          durationMs: 4_000,
          width: 1080,
          height: 1920,
          album: null,
          flags: ['slowMo'],
          imported: 'in-icloud',
          thumb: true,
        },
      ],
      total: 1,
    };
    expect(outputOf(transferContract.deviceItems, page).success).toBe(true);
    const summary = {
      items: 1,
      bytes: 100,
      newItems: 1,
      months: [{ month: '2026-10', items: 1, bytes: 100 }],
      albums: [],
    };
    expect(outputOf(transferContract.deviceSummary, summary).success).toBe(true);
    expect(
      outputOf(transferContract.deviceSummary, { ...summary, months: [{ month: 'Oct', items: 1, bytes: 1 }] })
        .success,
    ).toBe(false);
    expect(inputOf(transferContract.pauseDeviceImport, { runId }).success).toBe(true);
    expect(outputOf(transferContract.forgetUsbDebugKey, { forgotten: true }).success).toBe(true);
  });

  it('gets the adb key from main as PKCS#8, never a short value', () => {
    expect(outputOf(deviceKeysContract.adbKey, { pkcs8: 'A'.repeat(1_600) }).success).toBe(true);
    expect(outputOf(deviceKeysContract.adbKey, { pkcs8: 'short' }).success).toBe(false);
    expect(outputOf(deviceKeysContract.forgetAdbKey, { forgotten: false }).success).toBe(true);
  });

  it('stages a USB item with its run and hashes', () => {
    const staged = {
      sessionId: newId<'TransferSession'>(),
      uploadId: newId<'TransferUpload'>(),
      path: '/Volumes/SSD/.taalcut-staging/u2',
      companions: [],
      fileName: 'IMG_0418.MOV',
      sizeBytes: 1_000,
      mimeType: 'video/quicktime',
      lastModified: null,
      device: { id: newId<'TransferDevice'>(), label: 'iPhone', platform: 'ios' },
      reencode: { verdict: 'likely', reasons: ['device-converted'] },
      receivedAt: T0,
      channel: 'usb',
      usb: {
        runId,
        bridge: 'image-capture',
        deviceKey,
        itemKey,
        createdAt: T0,
        album: 'Trip',
        sha256: SHA,
        sourceSha256: null,
      },
    };
    expect(stagedImportSchema.parse(staged)).toEqual(staged);
    expect(stagedImportSchema.safeParse({ ...staged, usb: { ...staged.usb, sha256: 'x' } }).success).toBe(
      false,
    );
  });
});
