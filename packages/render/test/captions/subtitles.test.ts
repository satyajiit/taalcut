// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** SRT and VTT (SPEC section 6): format, rounding, CRLF and LF, UTF-8, word timestamps. */
import { describe, expect, it } from 'vitest';
import { FrameRate, RationalTime, type CaptionTrack } from '@taalcut/core';
import { frameMs, toSrt, toVtt } from '../../src/captions/subtitles';
import { captionTrackOf } from '../support/timeline';

const ntsc = FrameRate.of(30000, 1001);
const thirty = FrameRate.of(30);

describe('subtitles', () => {
  it('floors frame boundaries to the millisecond', () => {
    expect(frameMs(1, ntsc)).toBe(33);
    expect(frameMs(30, ntsc)).toBe(1001);
    expect(frameMs(3600 * 30, thirty)).toBe(3_600_000);
  });

  it('writes SRT: numbered from 1, HH:MM:SS,mmm, CRLF, no BOM', () => {
    const track = captionTrackOf(ntsc, [
      [45, 30, 'Hola niño'],
      [0, 30, '¿Qué tal?'],
    ]);
    const srt = toSrt(track, ntsc);
    expect(srt).toBe(
      '1\r\n00:00:00,000 --> 00:00:01,001\r\n¿Qué tal?\r\n' +
        '\r\n2\r\n00:00:01,501 --> 00:00:02,502\r\nHola niño\r\n',
    );
    expect(srt.charCodeAt(0)).not.toBe(0xfeff);
    expect(srt).not.toMatch(/[^\r]\n/u);
    expect(Buffer.from(srt, 'utf8').toString('utf8')).toBe(srt);
  });

  it('writes VTT: a header, HH:MM:SS.mmm, LF, escaped text', () => {
    const track = captionTrackOf(thirty, [[3600 * 30 + 15, 45, 'Tom & <Jerry>']]);
    expect(toVtt(track, thirty)).toBe('WEBVTT\n\n01:00:00.500 --> 01:00:02.000\nTom &amp; &lt;Jerry&gt;\n');
  });

  it('adds inner word timestamps when asked', () => {
    const track = captionTrackOf(thirty, [[30, 36, 'नमस्ते सबको यहाँ']]);
    // Three words over 36 frames: 12 each, starting at frames 30, 42 and 54.
    expect(toVtt(track, thirty, { wordTimestamps: true })).toBe(
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.200\nनमस्ते <00:00:01.400>सबको <00:00:01.800>यहाँ\n',
    );
  });

  it('never ends a cue where it starts, and handles an empty track', () => {
    const track: CaptionTrack = captionTrackOf(FrameRate.of(60000, 1001), [[0, 1, 'x']]);
    const cue = track.cues[0]!;
    expect(RationalTime.toFrames(cue.range.duration, FrameRate.of(60000, 1001))).toBe(1);
    expect(toSrt(track, FrameRate.of(60000, 1001))).toContain('00:00:00,000 --> 00:00:00,016');
    expect(toSrt({ ...track, cues: [] }, thirty)).toBe('');
    expect(toVtt({ ...track, cues: [] }, thirty)).toBe('WEBVTT\n');
  });
});
