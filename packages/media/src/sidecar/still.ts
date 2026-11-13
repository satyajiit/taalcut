// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Still metadata for Live Photo pairing. The mac helper reads ImageIO,
 * including Apple maker note key 17. The probe reader is the portable
 * fallback: size, orientation, capture time and device only.
 */
import { err, ok, type AsyncResult, type Result } from '@taalcut/core';
import { z } from 'zod';
import { fileParams } from '../errors';
import { helperCode, SidecarRejected, StillUnreadable } from './errors';
import { probeMedia } from '../probe/probe';
import type { ProbeResult } from '../probe/types';
import type { MediaContext } from '../ffmpeg';
import type { JsonLineSidecar } from './json-line';

export interface StillGps {
  readonly latitude: number;
  readonly longitude: number;
  readonly altitude?: number;
}

export interface StillMetadata {
  readonly width: number;
  readonly height: number;
  /** EXIF orientation, 1–8. */
  readonly orientation: number;
  readonly captureTime?: string;
  readonly offsetTime?: string;
  /** Apple maker note key 17. Absent on the probe fallback. */
  readonly contentIdentifier?: string;
  readonly gps?: StillGps;
  readonly make?: string;
  readonly model?: string;
  readonly hasGainMap: boolean;
}

export interface StillMetadataReader {
  read(path: string): AsyncResult<StillMetadata>;
}

const stillSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  orientation: z.number().int().min(1).max(8),
  captureTime: z.string().optional(),
  offsetTime: z.string().optional(),
  contentIdentifier: z.string().optional(),
  gps: z
    .object({
      latitude: z.number(),
      longitude: z.number(),
      altitude: z.number().optional(),
    })
    .optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  hasGainMap: z.boolean(),
});

export function createMacHelperStillReader(sidecar: JsonLineSidecar): StillMetadataReader {
  return {
    async read(path) {
      const response = await sidecar.request('image.properties', { path });
      if (!response.ok) {
        if (SidecarRejected.is(response.error) && helperCode(response.error) === 'image.unreadable') {
          return err(StillUnreadable(fileParams(path), { detail: response.error.detail }));
        }
        return response;
      }
      const parsed = stillSchema.safeParse(response.value);
      if (!parsed.success) {
        return err(StillUnreadable(fileParams(path), { detail: parsed.error.message }));
      }
      return ok(parsed.data);
    },
  };
}

/** Pure mapping. No content identifier, gain map or GPS: the probe does not carry the maker note. */
export function stillFromProbe(probe: ProbeResult): Result<StillMetadata> {
  const video = probe.video;
  if (!video || video.displayWidth <= 0 || video.displayHeight <= 0) {
    return err(StillUnreadable(fileParams(probe.path), { detail: probe.path }));
  }
  return ok({
    width: video.displayWidth,
    height: video.displayHeight,
    orientation: orientationOf(video.rotation),
    ...(probe.creationTime ? { captureTime: probe.creationTime } : {}),
    ...(probe.phone?.make ? { make: probe.phone.make } : {}),
    ...(probe.phone?.model ? { model: probe.phone.model } : {}),
    hasGainMap: false,
  });
}

export function createProbeStillReader(ctx: MediaContext): StillMetadataReader {
  return {
    async read(path) {
      const probed = await probeMedia(path, ctx);
      if (!probed.ok) {
        return err(StillUnreadable(fileParams(path), { detail: probed.error.detail }));
      }
      return stillFromProbe(probed.value);
    },
  };
}

function orientationOf(rotation: 0 | 90 | 180 | 270): number {
  if (rotation === 90) return 6;
  if (rotation === 180) return 3;
  if (rotation === 270) return 8;
  return 1;
}
