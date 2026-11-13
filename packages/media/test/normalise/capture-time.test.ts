// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-OEM: the local time a clip was shot at, from each phone's way of writing it. */
import { describe, expect, it } from 'vitest';
import { captureTimeOf, offsetMinutes } from '../../src/normalise/capture-time';

describe('captureTimeOf', () => {
  it("moves Samsung's UTC creation time by its utc_offset: a Galaxy clip shot at 11:30 local time", () => {
    expect(captureTimeOf({ creationTime: '2026-03-14T09:30:00.000000Z', utcOffset: '+0200' })).toEqual({
      captureTime: '2026-03-14T11:30:00+02:00',
      captureOffsetMin: 120,
    });
  });

  it('crosses midnight and keeps milliseconds', () => {
    expect(captureTimeOf({ creationTime: '2026-03-14T20:30:00.250000Z', utcOffset: '+0530' })).toEqual({
      captureTime: '2026-03-15T02:00:00.250+05:30',
      captureOffsetMin: 330,
    });
    expect(captureTimeOf({ creationTime: '2026-01-01T02:00:00Z', utcOffset: '-0500' })?.captureTime).toBe(
      '2025-12-31T21:00:00-05:00',
    );
  });

  it('keeps a UTC-only creation time without an offset: VID_0001.mp4 (the Sample Cam app) names no zone', () => {
    expect(captureTimeOf({ creationTime: '2026-03-14T07:15:00.000000Z' })).toEqual({
      captureTime: '2026-03-14T07:15:00Z',
    });
  });

  it("takes Apple's local creation date and its offset", () => {
    expect(
      captureTimeOf({
        creationDate: '2023-08-30T09:56:22-0400',
        creationTime: '2023-08-30T13:57:11.000000Z',
      }),
    ).toEqual({ captureTime: '2023-08-30T09:56:22-04:00', captureOffsetMin: -240 });
    expect(captureTimeOf({ creationDate: '2026-10-01T15:30:00+0545' })?.captureOffsetMin).toBe(345);
  });

  it("joins a photo's EXIF time and offset, and keeps a time with no offset unzoned", () => {
    expect(captureTimeOf({ still: { captureTime: '2026:03:01 12:34:56', offsetTime: '+05:30' } })).toEqual({
      captureTime: '2026-03-01T12:34:56+05:30',
      captureOffsetMin: 330,
    });
    expect(captureTimeOf({ still: { captureTime: '2026:03:01 12:34:56' } })).toEqual({
      captureTime: '2026-03-01T12:34:56',
    });
  });

  it('falls back from a still with no time to the container', () => {
    expect(captureTimeOf({ still: {}, creationTime: '2026-03-01T07:04:56Z' })?.captureTime).toBe(
      '2026-03-01T07:04:56Z',
    );
  });

  it('ignores a clock that was never set, a five-digit year and an offset out of range', () => {
    expect(captureTimeOf({ creationTime: '1904-01-01T00:00:00.000000Z' })).toBeUndefined();
    expect(
      captureTimeOf({ creationTime: '1970-01-01T00:00:00.000000Z', utcOffset: '+0200' }),
    ).toBeUndefined();
    expect(captureTimeOf({ creationTime: '40096-09-19T03:52:44.000000Z' })).toBeUndefined();
    expect(captureTimeOf({ creationTime: '2026-03-14T09:30:00Z', utcOffset: '+2500' })).toEqual({
      captureTime: '2026-03-14T09:30:00Z',
    });
  });
});

describe('offsetMinutes', () => {
  it('reads both ways of writing an offset', () => {
    expect(offsetMinutes('+0200')).toBe(120);
    expect(offsetMinutes('+02:00')).toBe(120);
    expect(offsetMinutes('-03:30')).toBe(-210);
    expect(offsetMinutes('+1400')).toBe(840);
  });

  it('refuses anything else', () => {
    for (const text of [undefined, '', 'Z', '0700', '+7', '+07:75', '+1500', '-1300', 'GMT+2'])
      expect(offsetMinutes(text)).toBeUndefined();
  });
});
