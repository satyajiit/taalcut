// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-PLACE: where the jobs process finds the places dataset, and the folder packaging ships it from. A packaged
 * layout is laid out as electron-builder's extraResources would (from → Resources/to, through the filter), and the
 * dataset is read and names a place from there, as the jobs process does with process.resourcesPath.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGeocoder, loadPlaces } from '@taalcut/library';
import { describe, expect, it } from 'vitest';
import { builderConfig } from '../packaging/builder-config';
import { placesResources } from '../packaging/places-resources';
import { PLACES_RESOURCE, placesDatasetPath } from '../src/shared/places-paths';

const desktop = join(import.meta.dirname, '..');

describe('the places dataset', () => {
  it('is in Resources/places when packaged and in packages/library/data in a checkout', () => {
    expect(placesDatasetPath({ packaged: true, resourcesPath: '/App/Resources', desktopDir: '/x' })).toBe(
      join('/App/Resources', 'places', 'places-v1.bin.gz'),
    );
    const checkout = placesDatasetPath({ packaged: false, resourcesPath: '/r', desktopDir: desktop });
    expect(checkout).toBe(join(desktop, '..', '..', 'packages', 'library', 'data', 'places-v1.bin.gz'));
    expect(existsSync(checkout)).toBe(true);
  });

  it('ships packages/library/data, its notice included, without dot-files', () => {
    expect(placesResources(desktop)).toEqual([
      {
        from: join(desktop, '..', '..', 'packages', 'library', 'data'),
        to: PLACES_RESOURCE,
        filter: ['**/*', '!**/.*'],
      },
    ]);
    expect(existsSync(join(desktop, '..', '..', 'packages', 'library', 'data', 'GEONAMES-NOTICE.txt'))).toBe(
      true,
    );
    expect(placesResources('/nowhere/apps/desktop')).toEqual([]);
  });

  it('is read from a packaged Resources folder, as the build config lays it out', () => {
    const config = builderConfig({}, desktop, {
      flavour: 'release',
      updateFeedUrl: undefined,
      updateChannel: undefined,
      crashDsn: undefined,
      telemetryUrl: undefined,
    });
    const [entry] = placesResources(desktop);
    expect(config.extraResources).toContainEqual(entry);
    const resources = mkdtempSync(join(tmpdir(), 'taalcut-places-resources-'));
    try {
      const set = entry as { from: string; to: string };
      cpSync(set.from, join(resources, set.to), {
        recursive: true,
        filter: (path) =>
          !path
            .slice(set.from.length)
            .split('/')
            .some((part) => part.startsWith('.')),
      });
      expect(readdirSync(join(resources, PLACES_RESOURCE)).sort()).toEqual([
        'GEONAMES-NOTICE.txt',
        'places-v1.bin.gz',
        'places.lock.json',
      ]);
      const path = placesDatasetPath({ packaged: true, resourcesPath: resources, desktopDir: '/nowhere' });
      const places = createGeocoder(loadPlaces(path));
      expect(places.placeAt(38.7223, -9.1393)).toMatchObject({ city: 'Lisbon', country: 'PT' });
    } finally {
      rmSync(resources, { recursive: true, force: true });
    }
  });
});
