// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  mediaUrl,
  playbackUrl,
  templateAssetUrl,
  templateReelUrl,
  type DerivedFileRef,
  type Playback,
  type TemplateId,
  type TemplateSummarySheet,
} from '@taalcut/core';

/**
 * Where the page loads footage from: thumbnails, posters and proxies (derived
 * files, by key) and template assets (a contact sheet, by hash). In Electron
 * that is main's app://media host, which the CSP allows; the fake paints
 * stand-in footage instead (fake/fake-media.ts). Null: nothing to show, so
 * the frame stays on the viewer grey.
 */
export interface MediaUrls {
  derived(ref: Pick<DerivedFileRef, 'key' | 'width' | 'height'>): string | null;
  /** A contact sheet: a template's whole sheet, or the part a template summary carries. */
  templateAsset(sheet: TemplateSummarySheet): string | null;
  /**
   * An image URL the render process gave (`renders.mediaUrl`'s poster or frame, under app://preview), as
   * the page can load it. Main serves app://preview, so in Electron it is the URL itself.
   */
  preview(url: string): string | null;
  /** UX2: what the clip page's <video> loads, the proxy copy or the original that is its own proxy. */
  playback(assetId: string, playback: Playback): string | null;
  /**
   * BRK1: the template's kept reel (REF1's `reference.mp4`), for the review's player. In Electron, main's
   * app://media/template-reel/<id>, which is a 404 when the template keeps no reel (the summary's `media` says).
   */
  templateReel(templateId: TemplateId): string | null;
}

export const appMediaUrls: MediaUrls = {
  derived: (ref) => mediaUrl(ref),
  templateAsset: (sheet) => templateAssetUrl(sheet),
  preview: (url) => url,
  playback: (assetId, playback) => playbackUrl(assetId, playback),
  templateReel: (templateId) => templateReelUrl(templateId),
};
