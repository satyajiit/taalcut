// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The measurement parsers on recorded FFmpeg output, and the sync maths on synthetic signals. Pure. */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cutPeak } from '../../src/qa/checks/sync';
import { parseAudioLevels } from '../../src/qa/measure/audio-pass';
import { parseRatio, parseStreamFacts, scanTopLevelBoxes } from '../../src/qa/measure/stream-facts';
import { correlate, driftOver } from '../../src/qa/measure/sync';
import { parseVideoMetadata } from '../../src/qa/measure/video-pass';
import { tempDir } from '../support/media';
import { rate30 } from './support';

describe('parseVideoMetadata', () => {
  // As `metadata=mode=print:file=` writes it: a header per frame, then that frame's lavfi keys.
  const text = [
    'frame:0    pts:0       pts_time:0',
    'lavfi.scd.score=0.000',
    'lavfi.bbox.w=270',
    'lavfi.bbox.h=480',
    'frame:1    pts:512     pts_time:0.0333333',
    'lavfi.black_start=0.0333333',
    'lavfi.scd.score=41.250',
    'frame:2    pts:1024    pts_time:0.0666667',
    'lavfi.freezedetect.freeze_start=0',
    'lavfi.freezedetect.freeze_duration=0.0666667',
    'lavfi.freezedetect.freeze_end=0.0666667',
    'lavfi.scd.score=0.100',
    'frame:3    pts:1536    pts_time:0.1',
    'lavfi.scd.score=junk',
    '',
  ].join('\n');

  it('reads scores, boxes and closed intervals per frame', () => {
    const parsed = parseVideoMetadata(text, rate30);
    expect(parsed.frames).toBe(4);
    expect(parsed.sceneScores).toEqual([0, 41.25, 0.1, 0]);
    expect(parsed.boxes).toEqual([{ width: 270, height: 480 }, null, null, null]);
    expect(parsed.freezes).toEqual([{ start: 0, end: 2 }]);
  });

  it('closes an interval still open at the end of the file on its last frame', () => {
    expect(parseVideoMetadata(text, rate30).black).toEqual([{ start: 1, end: 4 }]);
  });
});

describe('parseAudioLevels', () => {
  const log = (integrated: string, peak: string, max: string) =>
    [
      '[Parsed_ebur128_0 @ 0x1] t: 9.9   TARGET:-23 LUFS    M: -21.8 S: -21.8     I: -99.0 LUFS',
      '[Parsed_ebur128_0 @ 0x1] Summary:',
      '  Integrated loudness:',
      `    I:         ${integrated} LUFS`,
      '    Threshold: -31.8 LUFS',
      '  Loudness range:',
      '    LRA:         0.0 LU',
      '  True peak:',
      `    Peak:       ${peak} dBFS`,
      '[Parsed_volumedetect_1 @ 0x2] mean_volume: -24.1 dB',
      `[Parsed_volumedetect_1 @ 0x2] max_volume: ${max} dB`,
    ].join('\n');

  it('reads the summary, never a per-frame line', () => {
    expect(parseAudioLevels(log('-21.8', '-20.8', '-20.8'))).toEqual({
      integratedLufs: -21.8,
      loudnessRangeLu: 0,
      truePeakDbtp: -20.8,
      maxVolumeDb: -20.8,
      meanVolumeDb: -24.1,
    });
  });

  it('reads -inf for digital silence, and nothing from a log without a summary', () => {
    expect(parseAudioLevels(log('-70.0', '-inf', '-91.0'))?.truePeakDbtp).toBe(-Infinity);
    expect(parseAudioLevels('Stream map 0:a:0 matches no streams.')).toBeUndefined();
  });
});

describe('stream facts', () => {
  it('reads rotation side data, a missing colour tag and VideoToolbox level numbers', () => {
    const facts = parseStreamFacts(
      {
        streams: [
          { codec_type: 'video', codec_name: 'h264', level: 40, color_space: 'bt709', side_data_list: [{ rotation: -90 }], nb_read_packets: '60' },
          { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', duration_ts: 144000, time_base: '1/48000' },
        ],
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '2.000000', size: '2100000' },
      },
      ['ftyp', 'moov', 'mdat'],
    );
    expect(facts.video[0]).toMatchObject({ rotation: -90, level: 40, packets: 60, colorSpace: 'bt709' });
    expect(facts.video[0]!.colorTransfer).toBeUndefined();
    expect(facts.audio[0]).toMatchObject({ sampleRate: 48_000, durationTs: 144_000 });
    expect(facts.faststart).toBe(true);
  });

  it('parses ratios, refusing 0/0', () => {
    expect(parseRatio('30000/1001')).toEqual([30_000, 1001]);
    expect(parseRatio('9:16')).toEqual([9, 16]);
    expect(parseRatio('0/0')).toBeUndefined();
    expect(parseRatio(undefined)).toBeUndefined();
  });

  describe('scanTopLevelBoxes', () => {
    let work: Awaited<ReturnType<typeof tempDir>>;
    beforeAll(async () => {
      work = await tempDir('qa-boxes');
    });
    afterAll(() => work.dispose());

    const box = (type: string, payload: number) => {
      const buffer = Buffer.alloc(8 + payload);
      buffer.writeUInt32BE(8 + payload, 0);
      buffer.write(type, 4, 'latin1');
      return buffer;
    };

    it('lists boxes in file order, including a 64-bit size and a box to the end of the file', async () => {
      const large = Buffer.alloc(24);
      large.writeUInt32BE(1, 0);
      large.write('mdat', 4, 'latin1');
      large.writeBigUInt64BE(24n, 8);
      const tail = box('free', 4);
      tail.writeUInt32BE(0, 0);
      const path = join(work.dir, 'boxes.mp4');
      await writeFile(path, Buffer.concat([box('ftyp', 16), large, box('moov', 32), tail]));
      expect(await scanTopLevelBoxes(path)).toEqual(['ftyp', 'mdat', 'moov', 'free']);
    });
  });
});

describe('correlate', () => {
  const RATE = 16_000;
  /** Deterministic noise: correlation has one clear peak. */
  function noise(length: number, seed = 7): Float32Array {
    const out = new Float32Array(length);
    let state = seed;
    for (let i = 0; i < length; i++) {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      out[i] = state / 1_073_741_824 - 1;
    }
    return out;
  }

  it.each([0, 40, -25])('finds a %d ms lag (positive: the render is late)', (lagMs) => {
    const maxLag = RATE / 4;
    const width = RATE / 2;
    const source = noise(width + 2 * maxLag);
    const shift = Math.round((lagMs / 1000) * RATE);
    // The render plays the source `shift` samples late: render[i] = source[planned + i - shift].
    const render = source.slice(maxLag - shift, maxLag - shift + width).map((sample) => sample * 0.5);
    const result = correlate(render, source, maxLag);
    expect(result.lagMs).toBeCloseTo(lagMs, 5);
    expect(result.peak).toBeGreaterThan(0.99);
  });

  it('reports a weak peak for unrelated sound (inconclusive)', () => {
    const result = correlate(noise(4000, 1), noise(4000 + 800, 99), 400);
    expect(result.peak).toBeLessThan(0.3);
  });
});

describe('driftOver and cutPeak', () => {
  it('reads the slope of lag over time as drift over 60 s', () => {
    const points = [0, 10, 20, 30, 40, 50].map((at) => ({ at, lagMs: at * 0.5 }));
    expect(driftOver(points, 60)).toBeCloseTo(30, 6);
    expect(driftOver([{ at: 0, lagMs: 5 }], 60)).toBe(0);
  });

  it('picks the strongest scene change near a cut, ignoring scores under 8', () => {
    const scores = [0, 0, 7.9, 30, 12, 0];
    expect(cutPeak(scores, 2, 4)).toBe(3);
    expect(cutPeak(scores, 0, 2)).toBeUndefined();
  });
});
