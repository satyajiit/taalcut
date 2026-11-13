// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { canPreviewTrack } from '../src/features/insights/audio-preview';
import {
  buildAgentPromptFromTrack,
  buildCreateSearchFromTrack,
  parseEditsTracks,
} from '../src/features/make/edits-pulse-model';

beforeAll(() => i18n.loadAndActivate({ locale: 'en', messages: {} }));

describe('Edits track metadata', () => {
  it('retains supported local preview routes while remote URLs and capability flags stay metadata only', () => {
    const trackFor = (previewUrl?: string) =>
      parseEditsTracks(
        {
          tracks: [
            {
              id: 'preview-track',
              title: 'Preview track',
              hasPreview: true,
              previewUrl,
            },
          ],
        },
        new Set(),
      )[0]!;
    for (const url of ['app://media/music/example.mp3', 'app://preview/token/video.mp4']) {
      const track = trackFor(url);
      expect(track.previewUrl).toBe(url);
      expect(canPreviewTrack(track)).toBe(true);
    }
    const remote = trackFor('https://example.com/music.mp3');
    expect(remote.previewUrl).toBe('https://example.com/music.mp3');
    expect(canPreviewTrack(remote)).toBe(false);
    expect(trackFor()).toMatchObject({ hasPreview: true });
    expect(canPreviewTrack(trackFor())).toBe(false);
    for (const url of [
      'app://taalcut/music',
      'app://media:123/music',
      'app://user:secret@media/music',
      'app://user@preview/music',
      'http://example.com/music',
      'not a URL',
    ]) {
      const track = trackFor(url);
      expect(track.previewUrl).toBeUndefined();
      expect(canPreviewTrack(track)).toBe(false);
      expect(canPreviewTrack({ ...track, previewUrl: url })).toBe(false);
    }
  });

  it('preserves unknown duration and hooks without inventing song facts for a brief', () => {
    const [track] = parseEditsTracks(
      { tracks: [{ id: 'live-id', title: 'Live song', isRoyaltyFree: 'false' }] },
      new Set(),
    );
    expect(track).toBeDefined();
    expect(track!.durationSeconds).toBe(0);
    expect(track!.isRoyaltyFree).toBe(false);
    expect(track!.highlights).toEqual([]);
    expect(track!.artistName).toBe('');
    const brief = buildCreateSearchFromTrack(track!);
    expect(brief.duration).toBeUndefined();
    expect(brief.prompt).not.toContain('0s');
    expect(brief.prompt).not.toContain('3.0s');
    expect(buildAgentPromptFromTrack(track!)).not.toContain('length 0s');
  });

  it('keeps only supplied finite timing markers within the actual track duration', () => {
    const [track] = parseEditsTracks(
      {
        result: {
          tracks: [
            {
              id: 'live',
              title: 'Track',
              durationSeconds: 10,
              highlights: [-1, 0, 3.5, 3.5, 11, Infinity, '2'],
              highlightSegments: [{ startSeconds: 7 }, { startSeconds: NaN }],
            },
          ],
        },
      },
      new Set(),
    );
    expect(track!.highlights).toEqual([0, 3.5, 7]);
    expect(buildCreateSearchFromTrack(track!).duration).toBe(10);
    expect(buildAgentPromptFromTrack(track!)).not.toMatch(/viral|cleared|royalty-free|high-retention/i);
  });

  it('accepts true flags only and preserves the actual feed identifiers', () => {
    const [track] = parseEditsTracks(
      {
        tracks: [
          {
            id: 'feed-row',
            audioAssetId: 'actual-asset',
            title: 'Original audio',
            isSaved: 'false',
            isExplicit: 'false',
            license: { isRoyaltyFree: 'false', isLicensedMusic: true },
          },
        ],
      },
      new Set(['actual-asset']),
    );
    expect(track).toMatchObject({
      title: 'Original audio',
      isExplicit: false,
      isRoyaltyFree: false,
      isLicensedMusic: true,
      isSaved: true,
    });
    expect(buildCreateSearchFromTrack(track!).audioAssetId).toBe('actual-asset');
    expect(buildCreateSearchFromTrack(track!).prompt).toContain('audioAssetId: actual-asset');
    expect(buildCreateSearchFromTrack(track!).prompt).not.toContain('cleared');
  });

  it('rejects malformed rows and unsafe or fabricated preview URLs', () => {
    expect(
      parseEditsTracks({ tracks: [null, {}, { id: 'missing-title' }, { title: 'missing-id' }] }, new Set()),
    ).toEqual([]);
    for (const value of [
      'http://example.com/audio.mp3',
      'https://user:secret@example.com/a',
      'javascript:x',
      12,
    ]) {
      const [track] = parseEditsTracks({ tracks: [{ id: 'a', title: 'A', previewUrl: value }] }, new Set());
      expect(track!.previewUrl).toBeUndefined();
    }
    const [track] = parseEditsTracks(
      { tracks: [{ id: 'a', title: 'A', previewUrl: 'https://example.com/a.mp3' }] },
      new Set(),
    );
    expect(track!.previewUrl).toBe('https://example.com/a.mp3');
  });
});
