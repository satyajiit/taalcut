// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds the places dataset (LIB1-PLACE, src/places/dataset.ts) from GeoNames' dump (CC-BY 4.0,
 * https://download.geonames.org/export/dump/): cities1000 (every place of 1,000 people or more and every seat of a
 * region), admin1CodesASCII (first-level regions) and countryInfo. Sections of a city (PPLX) and historical,
 * abandoned or destroyed places are left out: a clip in central Lisbon is in Lisbon, not in its parish.
 *
 *   pnpm --filter @taalcut/library places:build                  # downloads the three files first
 *   pnpm --filter @taalcut/library places:build --from <dir>     # reads them from <dir> (cities1000.txt unzipped)
 *
 * Writes data/places-v1.bin.gz and data/places.lock.json (the source's date, the counts and the file's SHA-256).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  encodePlaces,
  NO_REGION,
  PLACES_DATASET_FILE,
  PLACES_DATASET_VERSION,
  type PlacesCityInput,
} from '../src/places/dataset';

const DUMP = 'https://download.geonames.org/export/dump/';
const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const LEFT_OUT = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);

async function download(dir: string): Promise<void> {
  for (const file of ['cities1000.zip', 'admin1CodesASCII.txt', 'countryInfo.txt']) {
    const response = await fetch(DUMP + file);
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    writeFileSync(join(dir, file), Buffer.from(await response.arrayBuffer()));
  }
  execFileSync('unzip', ['-o', '-q', join(dir, 'cities1000.zip'), '-d', dir]);
}

const rows = (path: string) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split('\t'));

export function buildPlaces(dir: string) {
  const countries = rows(join(dir, 'countryInfo.txt'))
    .map((r) => r[0] ?? '')
    .filter((code) => /^[A-Z]{2}$/.test(code))
    .sort();
  const countryIndex = new Map(countries.map((code, i) => [code, i]));
  const regions: [number, string][] = [];
  const regionIndex = new Map<string, number>();
  for (const [key = '', name = ''] of rows(join(dir, 'admin1CodesASCII.txt'))) {
    const country = countryIndex.get(key.slice(0, 2));
    if (country === undefined || !name) continue;
    regionIndex.set(key, regions.length);
    regions.push([country, name.normalize('NFC')]);
  }
  const zones: string[] = [];
  const zoneIndex = new Map<string, number>();
  const people = new Map<string, number>();
  const cities: PlacesCityInput[] = [];
  let source = '';
  for (const r of rows(join(dir, 'cities1000.txt'))) {
    const [id, name, , , lat, lon, , code = '', cc = '', , admin1 = ''] = r;
    const population = Number(r[14] ?? 0);
    const zoneName = r[17] ?? '';
    const country = countryIndex.get(cc);
    if (!id || !name || country === undefined || !zoneName || LEFT_OUT.has(code)) continue;
    if ((r[18] ?? '') > source) source = r[18] ?? '';
    let zone = zoneIndex.get(zoneName);
    if (zone === undefined) {
      zone = zones.length;
      zoneIndex.set(zoneName, zone);
      zones.push(zoneName);
    }
    const key = `${zone}:${country}`;
    people.set(key, (people.get(key) ?? 0) + (Number.isFinite(population) ? population : 0));
    cities.push({
      id: Number(id),
      name: name.normalize('NFC'),
      latitude: Number(lat),
      longitude: Number(lon),
      people: Number.isFinite(population) ? population : 0,
      country,
      region: regionIndex.get(`${cc}.${admin1}`) ?? NO_REGION,
      zone,
    });
  }
  // Near cities near each other in the file: the coordinates compress better.
  cities.sort(
    (a, b) => Math.floor(a.latitude) - Math.floor(b.latitude) || a.longitude - b.longitude || a.id - b.id,
  );
  const zonePeople = [...people].map(([key, n]): [number, number, number] => {
    const [zone, country] = key.split(':').map(Number) as [number, number];
    return [zone, country, n];
  });
  return { header: { source, countries, regions, zones, zonePeople }, cities };
}

async function main() {
  const from = process.argv.indexOf('--from');
  const dir = from > 0 ? process.argv[from + 1]! : mkdtempSync(join(tmpdir(), 'taalcut-geonames-'));
  if (from < 0) await download(dir);
  const { header, cities } = buildPlaces(dir);
  const file = encodePlaces(header, cities);
  writeFileSync(join(DATA, PLACES_DATASET_FILE), file);
  const lock = {
    file: PLACES_DATASET_FILE,
    version: PLACES_DATASET_VERSION,
    source: 'GeoNames cities1000, admin1CodesASCII, countryInfo',
    url: DUMP,
    licence: 'CC-BY-4.0',
    attribution: 'Contains data from GeoNames (https://www.geonames.org), licensed under CC BY 4.0.',
    sourceDate: header.source,
    cities: cities.length,
    regions: header.regions.length,
    countries: header.countries.length,
    zones: header.zones.length,
    bytes: file.length,
    sha256: createHash('sha256').update(file).digest('hex'),
  };
  writeFileSync(join(DATA, 'places.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  console.warn(`${PLACES_DATASET_FILE}: ${cities.length} cities, ${file.length} bytes`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
