// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the clip page's viewer can do, from the library's detail and the <video>: play, or why it can't. Each
 * reason is a real state of the pipeline or the file, said as it is; the viewer shows the shot's best frame
 * meanwhile. Words are the viewer's (clip-viewer.tsx); this file only decides.
 */
import type { AssetDetail, TaalcutError } from '@taalcut/core';

export type ViewerState =
  | { readonly kind: 'playable' }
  /** A still: nothing to play. */
  | { readonly kind: 'photo' }
  /** media.proxy hasn't run yet, or runs now. */
  | { readonly kind: 'preparing' }
  /** media.proxy can't run: the original isn't on this Mac now (the notices say where it is). */
  | { readonly kind: 'originalAway' }
  /** media.proxy failed: the library's cause when it has one. */
  | { readonly kind: 'proxyFailed'; readonly error: TaalcutError | null }
  /**
   * media.proxy finished but the media cache let its copy go (round 2): opening the clip makes it again, ahead of
   * background work (library SPEC, "UX2: the filmstrip and eviction").
   */
  | { readonly kind: 'again' }
  /** media.proxy was skipped and there is nothing to play. */
  | { readonly kind: 'noCopy' }
  /** The <video> couldn't load what the library named. */
  | { readonly kind: 'broken'; readonly source: 'proxy' | 'original' };

const PROXY = 'media.proxy';

export function viewerState(detail: AssetDetail, failed: boolean): ViewerState {
  if (detail.asset.kind === 'image') return { kind: 'photo' };
  if (detail.playback)
    return failed ? { kind: 'broken', source: detail.playback.source } : { kind: 'playable' };
  const proxy = detail.stages.find((stage) => stage.stage === PROXY);
  if (proxy?.state === 'failed') return { kind: 'proxyFailed', error: proxy.error ?? null };
  const away =
    detail.locations.length > 0 && detail.locations.every((location) => location.state !== 'present');
  if (proxy?.state === 'done') return { kind: 'again' };
  if (proxy?.state === 'skipped') return { kind: 'noCopy' };
  if (away) return { kind: 'originalAway' };
  return proxy ? { kind: 'preparing' } : { kind: 'noCopy' };
}

/** Width over height as the clip shows (upright), from what the library measured; 9:16 when it doesn't know yet. */
export function frameRatio(detail: AssetDetail): number {
  const playback = detail.playback?.source === 'original' ? detail.playback : null;
  const width = playback?.width ?? detail.facts?.width ?? detail.asset.width;
  const height = playback?.height ?? detail.facts?.height ?? detail.asset.height;
  if (width && height) return width / height;
  return detail.asset.orientation === 'landscape'
    ? 16 / 9
    : detail.asset.orientation === 'square'
      ? 1
      : 9 / 16;
}

/** One frame in ms, from the clip's frame rate (the copy to play keeps it); 30 fps until the library knows. */
export function frameMsOf(detail: AssetDetail): number {
  const rate = detail.playback?.source === 'original' ? detail.playback.frameRate : detail.facts?.frameRate;
  return rate && rate.num > 0 ? (1000 * rate.den) / rate.num : 1000 / 30;
}
