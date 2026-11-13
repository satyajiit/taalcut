// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The parts of a shot profile that aren't on the shot row. (Casting's 100 ms
 * curves and full-rate motion peaks are: vision writes them into the
 * analysis as core's `ShotSignals`.)
 *
 * - **Place clusters.** Assets with a capture location are grouped when they
 *   lie within 300 m of another member (single linkage over a grid, so a
 *   walk along a beach stays one place); the cluster's id is
 *   `geo:<its smallest asset id>`. Without a location, a shot whose
 *   description names a place is in `place:<that name, folded>`. Otherwise
 *   none (null never matches null in casting).
 */
import type { LibraryDatabase } from '../db/database';

/** Two capture locations within this are one place. */
export const PLACE_RADIUS_M = 300;
const EARTH_M = 6_371_000;
const CELL_DEG = (PLACE_RADIUS_M / EARTH_M) * (180 / Math.PI);

interface Located {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
}

function metres(a: Located, b: Located): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Single-linkage clusters of points within `PLACE_RADIUS_M`: points share a
 * cell (CELL_DEG of latitude square, wider in longitude by 1/cos) only with
 * neighbours, so each point is compared with the 3×3 cells around it.
 */
export function clusterPlaces(points: readonly Located[]): Map<string, string> {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  const cells = new Map<string, number[]>();
  const cellOf = (p: Located) => {
    const lonCell = CELL_DEG / Math.max(0.01, Math.cos((p.lat * Math.PI) / 180));
    return [Math.floor(p.lat / CELL_DEG), Math.floor(p.lon / lonCell)] as const;
  };
  points.forEach((point, i) => {
    const [y, x] = cellOf(point);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const j of cells.get(`${y + dy}:${x + dx}`) ?? [])
          if (metres(point, points[j] as Located) <= PLACE_RADIUS_M) parent[find(i)] = find(j);
    const key = `${y}:${x}`;
    cells.set(key, [...(cells.get(key) ?? []), i]);
  });
  const leader = new Map<number, string>();
  points.forEach((point, i) => {
    const root = find(i);
    const id = leader.get(root);
    if (id === undefined || point.id < id) leader.set(root, point.id);
  });
  return new Map(points.map((point, i) => [point.id, `geo:${leader.get(find(i))}`]));
}

/**
 * Place clusters for every located asset, recomputed when the located
 * assets change (their count or newest update), else cached.
 */
export function createPlaceClusters(db: LibraryDatabase): () => Map<string, string> {
  let stamp = '';
  let clusters = new Map<string, string>();
  return () => {
    const [head] = db.driver
      .prepare(
        `SELECT count(*) AS n, max(updated_at) AS at FROM assets
         WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND trashed_at IS NULL`,
      )
      .all();
    const now = `${String(head?.n ?? 0)}:${String(head?.at ?? '')}`;
    if (now === stamp) return clusters;
    const points = db.driver
      .prepare(
        `SELECT id, latitude, longitude FROM assets
         WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND trashed_at IS NULL ORDER BY id`,
      )
      .all()
      .flatMap((row) =>
        typeof row.latitude === 'number' && typeof row.longitude === 'number'
          ? [{ id: String(row.id), lat: row.latitude, lon: row.longitude }]
          : [],
      );
    clusters = clusterPlaces(points);
    stamp = now;
    return clusters;
  };
}

/** A description's place as a cluster id: case, accents and spacing folded. */
export function namedPlace(place: string | null | undefined): string | null {
  const folded = (place ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return folded ? `place:${folded}` : null;
}
