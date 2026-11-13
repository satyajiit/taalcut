// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The asset audio store as media's speech-PCM port (IX-D4, from the audio lane's request): `media.previews`
 * takes the waveform's peaks from the asset's audio pass instead of decoding its audio a second time. The
 * store (made with `keepPeaks`) keeps each video's peaks from its pass, so the waveform needs no pass of its
 * own whether it runs before language ID, between it and the transcript, or after the transcript removed the PCM.
 */
import type { SpeechPcmPort } from '@taalcut/media';
import type { AssetAudioStore } from './asset-audio-store';

/** `store` is looked up on each call: the app makes its store on the first indexing job. */
export function speechPcmPort(store: () => Pick<AssetAudioStore, 'peaks'>): SpeechPcmPort {
  return { peaks: (asset, ctx, signal) => store().peaks(asset, ctx, signal) };
}
