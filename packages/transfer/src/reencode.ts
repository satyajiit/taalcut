// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { REENCODE_SIGNALS, REENCODE_VERDICTS, ReencodeCheck } from '@taalcut/core';

export type ReencodeSignal = (typeof REENCODE_SIGNALS)[number];
export type ReencodeVerdict = (typeof REENCODE_VERDICTS)[number];

/** What the probe (or a test) can show the checker. Missing fields are "not seen". */
export interface ReencodeProbe {
  readonly videoCodec?: string | null;
  readonly audioCodec?: string | null;
  /** Container and stream tags. Keys may be the raw ffprobe names. */
  readonly tags?: Readonly<Record<string, string>>;
  readonly phone?: { readonly make?: string; readonly model?: string; readonly software?: string };
  /** A JPEG whose EXIF names a camera. */
  readonly jpegHasCameraExif?: boolean;
  /** True when the bytes are a JPEG (the stills path). */
  readonly jpeg?: boolean;
}

export interface ReencodeInput {
  readonly userAgent: string;
  readonly fileName: string;
  /** The phone's File.lastModified, epoch ms. */
  readonly lastModified: number | null;
  /** When the upload finished, epoch ms. */
  readonly receivedAt: number;
  readonly probe: ReencodeProbe;
}

const EXPORT_NAME = /^trim\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mov$/i;
const FRESH_MS = 5 * 60 * 1000;
const CAMERA_KEYS = ['com.apple.quicktime.make', 'com.apple.quicktime.model', 'com.apple.quicktime.software'];

/**
 * Turns what the desktop can see into a re-encode verdict.
 * The signal list and the rule are hypotheses until the device lab confirms them.
 */
export function checkReencode(input: ReencodeInput): ReencodeCheck {
  const ios = /iPhone|iPad/.test(input.userAgent) && /AppleWebKit/.test(input.userAgent);
  const video = (input.probe.videoCodec ?? '').toLowerCase();
  const audio = (input.probe.audioCodec ?? '').toLowerCase();
  const hevc = video === 'hevc' || video === 'h265' || video === 'hvc1';
  const h264Aac = (video === 'h264' || video === 'avc1') && (audio === 'aac' || audio.startsWith('aac'));
  const camera = hasCameraMetadata(input.probe);
  const reasons: ReencodeSignal[] = [];
  if (ios) reasons.push('ios-browser');
  if (h264Aac) reasons.push('h264-aac');
  if (!camera) reasons.push('no-camera-metadata');
  if (EXPORT_NAME.test(input.fileName)) reasons.push('export-file-name');
  if (isFresh(input.lastModified, input.receivedAt)) reasons.push('fresh-file-time');
  if (ios && input.probe.jpeg && !input.probe.jpegHasCameraExif) reasons.push('jpeg-without-camera-exif');
  if (hevc) reasons.push('hevc');
  if (camera) reasons.push('camera-metadata');

  const against = hevc || camera;
  const supporting = reasons.some((reason) =>
    reason === 'no-camera-metadata' || reason === 'export-file-name' || reason === 'fresh-file-time',
  );
  let verdict: ReencodeCheck['verdict'];
  if (against || !ios) verdict = 'unlikely';
  else if (ios && h264Aac && supporting) verdict = 'likely';
  else verdict = 'unknown';
  return { verdict, reasons: reasons.slice(0, 8) };
}

function hasCameraMetadata(probe: ReencodeProbe): boolean {
  if (probe.phone?.make || probe.phone?.model || probe.phone?.software) return true;
  const tags = probe.tags ?? {};
  return CAMERA_KEYS.some((key) => {
    const value = tags[key] ?? tags[key.toLowerCase()];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function isFresh(lastModified: number | null, receivedAt: number): boolean {
  if (lastModified === null || !Number.isFinite(lastModified)) return false;
  const delta = receivedAt - lastModified;
  return delta >= 0 && delta <= FRESH_MS;
}
