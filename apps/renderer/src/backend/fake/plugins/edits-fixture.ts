// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* eslint-disable lingui/no-unlocalized-strings -- realistic Instagram Edits MCP fixture data */

export interface FakeEditsTrack {
  readonly id: string;
  readonly title: string;
  readonly artistName: string;
  readonly audioAssetId: string;
  readonly durationSeconds: number;
  readonly highlights: readonly number[];
  readonly highlightSegments: readonly { readonly startSeconds: number }[];
  readonly isLicensedMusic: boolean;
  readonly isRoyaltyFree: boolean;
  readonly isExplicit: boolean;
  readonly hasPreview: boolean;
  readonly tab: 'Trending' | 'For You' | 'Original audio' | 'Royalty-free';
}

export const FAKE_EDITS_TRACKS: readonly FakeEditsTrack[] = [
  {
    id: '941658947548420',
    title: 'Bender (Reels Sound - Reveal)',
    artistName: 'Sam Marshall',
    audioAssetId: '941658947548420',
    durationSeconds: 26.2,
    highlights: [6.05, 14.2, 21.0],
    highlightSegments: [{ startSeconds: 6.05 }, { startSeconds: 14.2 }, { startSeconds: 21.0 }],
    isLicensedMusic: true,
    isRoyaltyFree: true,
    isExplicit: false,
    hasPreview: true,
    tab: 'Trending',
  },
  {
    id: '883412095610294',
    title: 'Jaipur Rooftop (Sunset Cut)',
    artistName: 'Aarav & The Tabla Club',
    audioAssetId: '883412095610294',
    durationSeconds: 18.5,
    highlights: [2.8, 7.6, 13.4],
    highlightSegments: [{ startSeconds: 2.8 }, { startSeconds: 7.6 }, { startSeconds: 13.4 }],
    isLicensedMusic: true,
    isRoyaltyFree: false,
    isExplicit: false,
    hasPreview: true,
    tab: 'Trending',
  },
  {
    id: '28899088246421709',
    title: 'Original audio — Monsoon Street Synth',
    artistName: 'nayan_yadav_963',
    audioAssetId: '28899088246421709',
    durationSeconds: 16.5,
    highlights: [2.2, 6.8, 12.1],
    highlightSegments: [{ startSeconds: 2.2 }, { startSeconds: 6.8 }, { startSeconds: 12.1 }],
    isLicensedMusic: false,
    isRoyaltyFree: false,
    isExplicit: false,
    hasPreview: true,
    tab: 'Original audio',
  },
  {
    id: '1308979976840081',
    title: 'Beatbox Foley (Reels Sound - Photo Dump)',
    artistName: 'POTG',
    audioAssetId: '1308979976840081',
    durationSeconds: 12.6,
    highlights: [1.5, 5.2, 9.4],
    highlightSegments: [{ startSeconds: 1.5 }, { startSeconds: 5.2 }, { startSeconds: 9.4 }],
    isLicensedMusic: true,
    isRoyaltyFree: true,
    isExplicit: false,
    hasPreview: true,
    tab: 'For You',
  },
  {
    id: '662901847231089',
    title: 'Velvet Transit (Night Drive)',
    artistName: 'Kairo Vance',
    audioAssetId: '662901847231089',
    durationSeconds: 30.0,
    highlights: [4.2, 12.6, 21.8, 26.4],
    highlightSegments: [
      { startSeconds: 4.2 },
      { startSeconds: 12.6 },
      { startSeconds: 21.8 },
      { startSeconds: 26.4 },
    ],
    isLicensedMusic: true,
    isRoyaltyFree: false,
    isExplicit: false,
    hasPreview: true,
    tab: 'For You',
  },
  {
    id: '691465059887028',
    title: 'Makeover (Reels Sound - Before And After)',
    artistName: 'POTG',
    audioAssetId: '691465059887028',
    durationSeconds: 13.4,
    highlights: [1.8, 4.5, 9.8],
    highlightSegments: [{ startSeconds: 1.8 }, { startSeconds: 4.5 }, { startSeconds: 9.8 }],
    isLicensedMusic: true,
    isRoyaltyFree: true,
    isExplicit: false,
    hasPreview: true,
    tab: 'Royalty-free',
  },
  {
    id: '1149249899465105',
    title: 'Do You (Reels Club Edit)',
    artistName: 'GEEZ',
    audioAssetId: '1149249899465105',
    durationSeconds: 24.0,
    highlights: [3.2, 9.6, 16.0],
    highlightSegments: [{ startSeconds: 3.2 }, { startSeconds: 9.6 }, { startSeconds: 16.0 }],
    isLicensedMusic: true,
    isRoyaltyFree: false,
    isExplicit: false,
    hasPreview: true,
    tab: 'Trending',
  },
  {
    id: '28918518504496185',
    title: 'Original audio — Golden Hour Acoustic',
    artistName: 'merajhepy',
    audioAssetId: '28918518504496185',
    durationSeconds: 17.6,
    highlights: [2.5, 8.0, 13.5],
    highlightSegments: [{ startSeconds: 2.5 }, { startSeconds: 8.0 }, { startSeconds: 13.5 }],
    isLicensedMusic: false,
    isRoyaltyFree: false,
    isExplicit: false,
    hasPreview: true,
    tab: 'Original audio',
  },
];

export function handleFakeInstagramEditsCall(
  toolName: string,
  input: Record<string, unknown>,
  savedIds: Set<string>,
): Record<string, unknown> {
  if (toolName === 'api.browseMusicCategories') {
    return {
      ok: true,
      count: 4,
      browsable: true,
      categories: [
        { name: 'Trending', count: 8 },
        { name: 'For You', count: 15 },
        { name: 'Original audio', count: 30 },
        { name: 'Royalty-free', count: 30 },
      ],
    };
  }
  if (toolName === 'api.listMusicTracks') {
    const tab = typeof input['tab'] === 'string' ? input['tab'] : 'Trending';
    const query = typeof input['query'] === 'string' ? input['query'].trim().toLowerCase() : '';
    const license = typeof input['license'] === 'string' ? input['license'] : 'any';
    const filtered = FAKE_EDITS_TRACKS.filter((track) => {
      if (tab && tab !== 'Trending' && track.tab !== tab) return false;
      if ((license === 'royaltyFree' || license === 'royalty_free') && !track.isRoyaltyFree) return false;
      if (license === 'licensed' && track.isRoyaltyFree) return false;
      if (
        query &&
        !track.title.toLowerCase().includes(query) &&
        !track.artistName.toLowerCase().includes(query)
      ) {
        return false;
      }
      return true;
    });
    const tracks = filtered.length > 0 || query ? filtered : FAKE_EDITS_TRACKS;
    return {
      ok: true,
      tab,
      count: tracks.length,
      tracks: tracks.map((track) => ({
        ...track,
        isSaved: savedIds.has(track.id),
      })),
    };
  }
  if (toolName === 'api.getSavedTracks') {
    const tracks = FAKE_EDITS_TRACKS.filter((track) => savedIds.has(track.id));
    return {
      ok: true,
      savedCount: tracks.length,
      count: tracks.length,
      tracks,
    };
  }
  if (toolName === 'api.getMusicTrackDetails') {
    const key = typeof input['track'] === 'string' ? input['track'].trim() : '';
    const found =
      FAKE_EDITS_TRACKS.find(
        (track) =>
          track.id === key ||
          track.audioAssetId === key ||
          track.title.toLowerCase() === key.toLowerCase(),
      ) ?? FAKE_EDITS_TRACKS[0]!;
    return {
      ok: true,
      previewing: input['preview'] === true,
      miniPlayerVisible: input['preview'] === true,
      ...found,
    };
  }
  if (toolName === 'api.favoriteMusicTrack') {
    const key = typeof input['track'] === 'string' ? input['track'].trim() : '';
    const found = FAKE_EDITS_TRACKS.find(
      (track) =>
        track.id === key ||
        track.audioAssetId === key ||
        track.title.toLowerCase() === key.toLowerCase(),
    );
    const id = found?.id ?? key;
    if (id) {
      if (savedIds.has(id)) savedIds.delete(id);
      else savedIds.add(id);
    }
    return {
      ok: true,
      saved: id ? savedIds.has(id) : true,
      trackId: id,
    };
  }
  if (toolName === 'api.listProjects') {
    return {
      ok: true,
      cloudRefreshTimedOut: false,
      projects: [
        {
          id: 'edits-draft-01',
          name: 'Monsoon Chai Sequence',
          durationSeconds: 18.4,
          clipCount: 9,
          audioTitle: 'Jaipur Rooftop (Sunset Cut)',
        },
        {
          id: 'edits-draft-02',
          name: 'Studio Desk Unboxing',
          durationSeconds: 24.0,
          clipCount: 12,
          audioTitle: 'Bender (Reels Sound - Reveal)',
        },
      ],
    };
  }
  return { ok: true };
}
