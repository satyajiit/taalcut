// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-OEM: what the fake's sample clips say about the phone that shot them, as the real library does: the zone it
 * was shot in on the summary, and the local time with its offset, the camera, its lens or model number, the app
 * that wrote the file and its capture mode in the facts.
 */
import type { AssetSummary, MediaFacts } from '@taalcut/core';
import type { SampleClip } from './sample-words';

export function phoneSummary(
  clip: SampleClip,
  fallback: number,
): Pick<AssetSummary, 'capturedAt' | 'captureOffset'> {
  return {
    capturedAt: clip.phone?.capturedAt ?? fallback,
    ...(clip.phone?.captureOffset ? { captureOffset: clip.phone.captureOffset } : {}),
  };
}

/** '2026-03-14T11:30:00+02:00' for a zone the file names; the UTC instant otherwise, as an MP4 writes it. */
function captureTimeOf(at: number, offset: AssetSummary['captureOffset']): string {
  if (!offset || offset.from !== 'file') return new Date(at).toISOString().replace('.000Z', 'Z');
  const local = new Date(at + offset.minutes * 60_000).toISOString().slice(0, 19);
  const abs = Math.abs(offset.minutes);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${local}${offset.minutes < 0 ? '-' : '+'}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}

export function phoneFacts(
  clip: SampleClip,
  summary: AssetSummary,
): Pick<MediaFacts, 'captureTime' | 'captureOffsetMin' | 'device' | 'captureMode'> {
  const phone = clip.phone;
  const offset = summary.captureOffset;
  const named = { ...phone, make: clip.device.make, model: clip.device.model };
  const device = Object.fromEntries(
    (['make', 'model', 'modelCode', 'lens', 'app', 'appDevice'] as const).flatMap((key) =>
      named[key] ? [[key, named[key]]] : [],
    ),
  ) as NonNullable<MediaFacts['device']>;
  return {
    captureTime: captureTimeOf(summary.capturedAt ?? summary.addedAt, offset),
    ...(offset?.from === 'file' ? { captureOffsetMin: offset.minutes } : {}),
    ...(Object.keys(device).length > 0 ? { device } : {}),
    ...(phone?.captureMode ? { captureMode: phone.captureMode } : {}),
  };
}
