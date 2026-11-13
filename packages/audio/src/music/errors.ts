// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Generated music and the music pack (SPEC P3.12). */
import { defineError } from '@taalcut/core';

/** Two generations missed the beat map after the warp. Its fix keeps the track and re-times the cuts to it. */
export const MusicOffGrid = defineError<{ p95ErrorMs: number }>('audio.music_off_grid');
/** A bar would need a stretch outside 0.85–1.15. */
export const WarpOutOfRange = defineError<{ ratio: number }>('audio.warp_out_of_range');
/** The music pack has no tracks (the PO hasn't picked them, or the component isn't installed). */
export const MusicLibraryEmpty = defineError('audio.music_library_empty');
/** No track with that id in the pack. */
export const MusicTrackUnknown = defineError<{ trackId: string }>('audio.music_track_unknown');
