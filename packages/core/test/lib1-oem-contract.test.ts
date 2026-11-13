// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-OEM: the time zone a clip was shot in, as its facts say and as the library settled it. */
import { describe, expect, it } from 'vitest';
import {
  assetSummarySchema,
  CAPTURE_OFFSET_MAX,
  CAPTURE_OFFSET_MIN,
  captureOffsetSchema,
  mediaFactsSchema,
  newId,
} from '@taalcut/core';

const facts = {
  version: 1,
  width: 1080,
  height: 1920,
  orientation: 'portrait',
  variableFrameRate: true,
  hdr: 'hlg',
  speed: 'normal',
  speedFactor: 1,
  retimedInFile: false,
  hasAudio: true,
} as const;

const summary = {
  id: newId<'Asset'>(),
  kind: 'video',
  name: '20260314_113000.mp4',
  capturedAt: 1_773_480_600_000,
  addedAt: 1_792_600_000_000,
  duration: { value: 158, rate: { num: 30, den: 1 } },
  width: 1080,
  height: 1920,
  orientation: 'portrait',
  availability: 'online',
  sourceIds: [newId<'Source'>()],
  description: null,
  quality: null,
  shotCount: 0,
  language: null,
  index: { state: 'done', done: 15, total: 15 },
  thumbnail: null,
  reencode: null,
  trashed: false,
  provenance: { kind: 'captured' },
} as const;

describe('MediaFacts.captureOffsetMin', () => {
  it('takes whole minutes from UTC−12:00 to UTC+14:00', () => {
    for (const minutes of [CAPTURE_OFFSET_MIN, -300, 0, 330, 120, 345, CAPTURE_OFFSET_MAX])
      expect(mediaFactsSchema.safeParse({ ...facts, captureOffsetMin: minutes }).success).toBe(true);
    for (const minutes of [CAPTURE_OFFSET_MIN - 1, CAPTURE_OFFSET_MAX + 1, 7.5])
      expect(mediaFactsSchema.safeParse({ ...facts, captureOffsetMin: minutes }).success).toBe(false);
  });

  it('is optional: facts stored before LIB1 still parse', () => {
    expect(mediaFactsSchema.safeParse(facts).success).toBe(true);
  });
});

describe('AssetSummary.captureOffset', () => {
  it('says the offset and where it came from', () => {
    for (const from of ['file', 'nearby'] as const) {
      const parsed = assetSummarySchema.parse({ ...summary, captureOffset: { minutes: 120, from } });
      expect(parsed.captureOffset).toEqual({ minutes: 120, from });
    }
    expect(assetSummarySchema.parse({ ...summary, captureOffset: null }).captureOffset).toBeNull();
  });

  it('is absent from a summary made before LIB1', () => {
    expect(assetSummarySchema.parse(summary).captureOffset).toBeUndefined();
  });

  it('refuses an unknown source or an offset out of range', () => {
    expect(captureOffsetSchema.safeParse({ minutes: 120, from: 'guess' }).success).toBe(false);
    expect(captureOffsetSchema.safeParse({ minutes: 900, from: 'file' }).success).toBe(false);
  });
});

describe('MediaFacts.device and captureMode', () => {
  it('keeps the model number, the lens and the app that wrote the file', () => {
    const device = {
      make: 'Samsung',
      model: 'Galaxy Example',
      modelCode: 'SM-X000Z',
      lens: 'iPhone 14 Pro back camera 2.22mm f/2.2',
      app: 'Sample Cam',
      appDevice: 'XC01',
    };
    const parsed = mediaFactsSchema.parse({ ...facts, device, captureMode: 'Time-lapse' });
    expect(parsed.device).toEqual(device);
    expect(parsed.captureMode).toBe('Time-lapse');
  });

  it('refuses empty or overlong names', () => {
    expect(mediaFactsSchema.safeParse({ ...facts, device: { lens: '' } }).success).toBe(false);
    expect(mediaFactsSchema.safeParse({ ...facts, device: { modelCode: 'x'.repeat(33) } }).success).toBe(
      false,
    );
    expect(mediaFactsSchema.safeParse({ ...facts, captureMode: 'x'.repeat(41) }).success).toBe(false);
  });
});
