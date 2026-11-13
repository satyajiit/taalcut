// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V5 done-when, automated half: a 30-clip timeline (24, 25, 30 and 29.97 fps media on a 30 and a 29.97
 * canvas, two ramps, three transitions, gaps, stills, music and a voice track, 12 text items, an offline
 * original) goes through both writers, and each file reads back to the timeline's own cut list, 0 frames off.
 * The Resolve and Final Cut half is the manual check in the SPEC.
 */
import { FrameRates, type FrameRate } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { EXPORTERS } from '../../src/interchange/catalog';
import { cutDifferences, cutList } from '../../src/interchange/cut-list';
import { fcpxmlCutList } from '../../src/interchange/fcpxml/read-back';
import { otioCutList, readOtio } from '../../src/interchange/otio/read-back';
import { clipIds, originals, thirtyClipTimeline } from '../fixtures/interchange';

const CANVASES: [string, FrameRate][] = [
  ['30', FrameRates.fps30],
  ['29.97', FrameRates.fps29_97],
];

describe.each(CANVASES)('a 30-clip timeline on a %s fps canvas', (_label, rate) => {
  const timeline = thirtyClipTimeline(rate);
  const offline = timeline.tracks[0]?.items.find(
    (item) => item.type === 'clip' && item.media.kind === 'video',
  );
  const media = originals(timeline, new Set(offline?.type === 'clip' ? [offline.media.assetId] : []));
  const expected = cutList(timeline);

  it('has what the fixture promises', () => {
    expect(clipIds(timeline)).toHaveLength(30);
    expect(expected.filter((entry) => entry.track === 'V1' && entry.kind === 'gap')).toHaveLength(2);
    expect(expected.filter((entry) => entry.track === 'A1')).toHaveLength(2);
    expect(expected.filter((entry) => entry.track === 'music')).toHaveLength(1);
  });

  it.each(EXPORTERS.map((exporter) => [exporter.id, exporter] as const))(
    '%s reads back cut for cut',
    (_id, exporter) => {
      const written = exporter.write(timeline, { media, pathStyle: 'fileUrl' });
      if (!written.ok) throw new Error(written.error.detail);
      expect(cutDifferences(expected, written.value.cutList)).toEqual([]);
      // Read the text again from scratch, as another editor would.
      const again =
        exporter.id === 'otio'
          ? (() => {
              const parsed = readOtio(written.value.text);
              if (!parsed.ok) throw new Error(parsed.error.detail);
              return otioCutList(parsed.value);
            })()
          : (() => {
              const parsed = fcpxmlCutList(written.value.text);
              if (!parsed.ok) throw new Error(parsed.error.detail);
              return parsed.value;
            })();
      expect(cutDifferences(expected, again)).toEqual([]);
    },
  );

  it.each(EXPORTERS.map((exporter) => [exporter.id, exporter] as const))(
    '%s lists what another editor will not get',
    (_id, exporter) => {
      const written = exporter.write(timeline, { media, pathStyle: 'fileUrl' });
      if (!written.ok) throw new Error(written.error.detail);
      const codes = written.value.warnings.map((warning) => warning.code);
      expect(codes.filter((code) => code === 'mediaOffline')).toHaveLength(1);
      expect(codes.filter((code) => code === 'rampApproximated')).toHaveLength(2);
      expect(codes.filter((code) => code === 'transitionAsCut')).toHaveLength(3);
      expect(codes.filter((code) => code === 'imageAsStill')).toHaveLength(2);
      expect(written.value.warnings.find((warning) => warning.code === 'textAsMarker')).toEqual({
        code: 'textAsMarker',
        count: 12,
      });
    },
  );

  it('notices a writer that moves a cut', () => {
    const written = EXPORTERS[0].write(timeline, { media, pathStyle: 'fileUrl' });
    if (!written.ok) throw new Error(written.error.detail);
    const moved = written.value.cutList.map((entry, index) =>
      index === 4 ? { ...entry, start: entry.start + 1 } : entry,
    );
    expect(cutDifferences(expected, moved)).toHaveLength(1);
    expect(cutDifferences(expected, moved, 1)).toEqual([]);
  });
});
