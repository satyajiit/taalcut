// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which file the asset's analysis decodes (IX-D1): its own file, or the
 * proxy media already encoded. The proxy is cheap to decode (1280 px H.264
 * against, say, 4K HEVC) but exists only after `media.proxy`, so reading it
 * makes `vision.shots` wait for that stage. The hardware profile states a
 * preference (`preferredFrameInput`, measured on the bench and recorded in
 * the vision SPEC); a proxy is used only where it answers the same questions:
 * a video, on the asset's own frame grid (not a slow-motion proxy on the
 * native rate), at least as large as the OCR frames (1280 px).
 */
import { VISION_CONFIG } from '../config';

export type FrameInput = 'original' | 'proxy';

/** What the stage knows about the stored proxy. */
export interface ProxyFacts {
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: { readonly num: number; readonly den: number };
}

export interface GridFacts {
  readonly kind: 'video' | 'image' | 'audio';
  readonly rate: { readonly num: number; readonly den: number };
}

/** The tier's decoder decides: VideoToolbox decodes 4K HEVC fast enough that the original pass wins (bench). */
export function preferredFrameInput(decoder: 'videotoolbox' | 'nvdec' | 'd3d11va' | 'none'): FrameInput {
  return decoder === 'none' ? 'proxy' : 'original';
}

export function frameInputFor(
  preferred: FrameInput,
  asset: GridFacts,
  proxy: ProxyFacts | undefined,
): FrameInput {
  if (preferred !== 'proxy' || !proxy || asset.kind !== 'video') return 'original';
  const rate = proxy.frameRate;
  if (!rate || rate.num * asset.rate.den !== asset.rate.num * rate.den) return 'original';
  const longSide = Math.max(proxy.width ?? 0, proxy.height ?? 0);
  return longSide >= VISION_CONFIG.breakdown.ocrLongSide ? 'proxy' : 'original';
}
