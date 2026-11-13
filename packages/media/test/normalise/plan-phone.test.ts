// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-OEM: what phones write reaches the clip's facts: the local time with its offset, the camera, the mode. */
import { mediaFactsSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { planNormalisation } from '../../src/normalise/plan';
import type { PhoneMetadata, ProbeResult } from '../../src/probe/types';
import { probeOf, videoStream } from '../helpers/probe-fixture';

function clip(phone: PhoneMetadata | undefined, creationTime?: string): ProbeResult {
  const video = videoStream({
    averageFrameRate: { num: 30, den: 1 },
    frameRate: { num: 30, den: 1 },
    duration: { value: 2_000_000, rate: 1_000_000 },
    frameCount: 60,
  });
  return {
    ...probeOf('/tmp/20260314_113000.mp4', video),
    ...(phone ? { phone } : {}),
    ...(creationTime ? { creationTime } : {}),
  };
}

function factsOf(probe: ProbeResult, still?: Parameters<typeof planNormalisation>[1]) {
  const plan = planNormalisation(probe, still);
  if (!plan.ok) throw new Error(plan.error.code);
  expect(mediaFactsSchema.safeParse(plan.value.facts).success).toBe(true);
  return plan.value.facts;
}

describe('the facts of a phone clip', () => {
  it('20260314_113000.mp4: Samsung, Galaxy Example, filmed at 11:30 UTC+2', () => {
    const facts = factsOf(
      clip(
        {
          make: 'Samsung',
          model: 'Galaxy Example',
          modelCode: 'SM-X000Z',
          utcOffset: '+0200',
          captureFrameRate: 30,
        },
        '2026-03-14T09:30:00.000000Z',
      ),
    );
    expect(facts.captureTime).toBe('2026-03-14T11:30:00+02:00');
    expect(facts.captureOffsetMin).toBe(120);
    expect(facts.device).toEqual({ make: 'Samsung', model: 'Galaxy Example', modelCode: 'SM-X000Z' });
  });

  it('VID_0001.mp4: the Sample Cam app, no maker, and no zone of its own', () => {
    const facts = factsOf(clip({ app: 'Sample Cam', appDevice: 'XC01' }, '2026-03-14T07:15:00.000000Z'));
    expect(facts.captureTime).toBe('2026-03-14T07:15:00Z');
    expect(facts.captureOffsetMin).toBeUndefined();
    expect(facts.device).toEqual({ app: 'Sample Cam', appDevice: 'XC01' });
  });

  it("an iPhone: Apple's offset, its lens and its capture mode", () => {
    const facts = factsOf(
      clip({
        make: 'Apple',
        model: 'iPhone 14 Pro',
        creationDate: '2023-08-30T09:56:22-0400',
        lens: 'iPhone 14 Pro back camera 2.22mm f/2.2',
        captureMode: 'Time-lapse',
      }),
    );
    expect(facts).toMatchObject({
      captureTime: '2023-08-30T09:56:22-04:00',
      captureOffsetMin: -240,
      device: { make: 'Apple', model: 'iPhone 14 Pro', lens: 'iPhone 14 Pro back camera 2.22mm f/2.2' },
      captureMode: 'Time-lapse',
    });
  });

  it("a photo: EXIF's make wins over the movie's, and its offset is kept", () => {
    const still = { orientation: 1, captureTime: '2026:03:01 12:34:56', offsetTime: '+05:30', make: 'Apple' };
    const facts = factsOf(clip({ make: 'Samsung' }), { still });
    expect(facts.captureTime).toBe('2026-03-01T12:34:56+05:30');
    expect(facts.captureOffsetMin).toBe(330);
    expect(facts.device?.make).toBe('Apple');
  });

  it('a file with no phone metadata says nothing about a camera', () => {
    const facts = factsOf(clip(undefined, '2026-03-14T07:15:00.000000Z'));
    expect(facts.device).toBeUndefined();
    expect(facts.captureMode).toBeUndefined();
  });
});
