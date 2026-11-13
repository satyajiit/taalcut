// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** ISO 6709 as phones write it: `+19.0760+072.8777+010.000/`. */
const ISO6709 = /^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)?/;

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly altitudeM?: number;
}

export function parseIso6709(text: string | undefined): GeoPoint | undefined {
  if (!text) return undefined;
  const match = ISO6709.exec(text.trim());
  if (!match) return undefined;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  const altitude = match[3] === undefined ? undefined : Number(match[3]);
  return {
    latitude,
    longitude,
    ...(altitude !== undefined && Number.isFinite(altitude) ? { altitudeM: altitude } : {}),
  };
}

/** Square within 5% of the other side, else the taller or wider upright frame. */
export function orientationOf(width: number, height: number): 'portrait' | 'landscape' | 'square' {
  if (width <= 0 || height <= 0) return 'square';
  if (Math.abs(width / height - 1) <= 0.05) return 'square';
  return height > width ? 'portrait' : 'landscape';
}
