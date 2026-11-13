// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ProbeResult } from '@taalcut/media';
import type { ReencodeProbe } from '../reencode';

/** Accepts a media ProbeResult, the smaller probe the tests pass, or a failed probe. */
export function normaliseProbe(
  value: ProbeResult | ReencodeProbe | { readonly ok: false; readonly error?: unknown },
): ReencodeProbe {
  if (isFailed(value)) return {};
  if (isMedia(value)) return fromMedia(value);
  return {
    videoCodec: value.videoCodec ?? null,
    audioCodec: value.audioCodec ?? null,
    tags: value.tags,
    phone: value.phone,
    jpeg: value.jpeg,
    jpegHasCameraExif: value.jpegHasCameraExif,
  };
}

function isFailed(
  value: ProbeResult | ReencodeProbe | { readonly ok: false },
): value is { readonly ok: false } {
  return 'ok' in value && value.ok === false;
}

function isMedia(value: ProbeResult | ReencodeProbe | { readonly ok: false }): value is ProbeResult {
  return 'container' in value && 'streams' in value;
}

function fromMedia(result: ProbeResult): ReencodeProbe {
  const format = result.container.formatName.toLowerCase();
  const jpeg = format.includes('jpeg') || format.includes('jpg') || format.includes('image2');
  const tags = result.tags;
  const phone = result.phone;
  const cameraTag = Boolean(tags['com.apple.quicktime.make'] || tags['Make'] || tags['Model']);
  return {
    videoCodec: result.video?.codec ?? null,
    audioCodec: result.audio?.codec ?? null,
    tags,
    phone: phone ? { make: phone.make, model: phone.model, software: phone.software } : undefined,
    jpeg,
    jpegHasCameraExif: jpeg && (Boolean(phone?.make) || cameraTag),
  };
}
