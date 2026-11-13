// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The places dataset (LIB1-PLACE): GeoNames' cities of 1,000 people or more (CC-BY 4.0), with their first-level
 * regions, countries and time zones, built by `scripts/build-places.ts` into one gzipped file that ships with the
 * app (`data/places-v1.bin.gz`). Read once per process, into typed arrays, and looked up on this Mac only.
 *
 * Layout, little-endian, inside gzip: "TCPL", a u32 version, a u32 header length and the header (JSON: the source's
 * date, countries, regions, zones, each zone's population by country, the counts), then, each padded to 4 bytes:
 * latitudes and longitudes (i32, degrees × 1e5), GeoNames ids (u32), people (u32), regions (u16, 0xffff for none), countries (u8),
 * zones (u16), the ends of the names (u32, into the names' UTF-8 bytes) and the names.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';

export const PLACES_DATASET_VERSION = 1;
export const PLACES_DATASET_FILE = 'places-v1.bin.gz';
const MAGIC = 'TCPL';
export const NO_REGION = 0xffff;
const SCALE = 1e5;

export interface PlacesHeader {
  /** When the GeoNames dump was taken (YYYY-MM-DD). */
  readonly source: string;
  /** ISO 3166-1 alpha-2 codes, by index. */
  readonly countries: readonly string[];
  /** [country index, name] by index. */
  readonly regions: readonly (readonly [number, string])[];
  /** IANA time zone names, by index. */
  readonly zones: readonly string[];
  /** [zone index, country index, people in its cities]: the time-zone hint's weights. */
  readonly zonePeople: readonly (readonly [number, number, number])[];
  readonly cities: number;
}

/** One city as the build script hands it over. */
export interface PlacesCityInput {
  readonly id: number;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly people: number;
  readonly country: number;
  readonly region: number;
  readonly zone: number;
}

export interface PlacesDataset {
  readonly header: PlacesHeader;
  readonly lat: Int32Array;
  readonly lon: Int32Array;
  readonly id: Uint32Array;
  /** How many people live there, as GeoNames counts them (0 where it doesn't). */
  readonly people: Uint32Array;
  readonly region: Uint16Array;
  readonly country: Uint8Array;
  readonly zone: Uint16Array;
  /** City i's name, decoded on demand. */
  nameOf(i: number): string;
}

const pad4 = (n: number) => (4 - (n % 4)) % 4;

/** The gzipped file for these cities (the build script's last step). */
export function encodePlaces(
  header: Omit<PlacesHeader, 'cities'>,
  cities: readonly PlacesCityInput[],
): Buffer {
  const n = cities.length;
  const names = cities.map((c) => Buffer.from(c.name, 'utf8'));
  const nameEnds = new Uint32Array(n);
  let end = 0;
  names.forEach((name, i) => {
    end += name.length;
    nameEnds[i] = end;
  });
  const json = Buffer.from(JSON.stringify({ ...header, cities: n }), 'utf8');
  const head = Buffer.alloc(12);
  head.write(MAGIC, 0, 'ascii');
  head.writeUInt32LE(PLACES_DATASET_VERSION, 4);
  head.writeUInt32LE(json.length, 8);
  const sections: Buffer[] = [head, json, Buffer.alloc(pad4(12 + json.length))];
  const typed = [
    Int32Array.from(cities, (c) => Math.round(c.latitude * SCALE)),
    Int32Array.from(cities, (c) => Math.round(c.longitude * SCALE)),
    Uint32Array.from(cities, (c) => c.id),
    Uint32Array.from(cities, (c) => Math.min(0xffffffff, Math.max(0, Math.round(c.people)))),
    Uint16Array.from(cities, (c) => c.region),
    Uint8Array.from(cities, (c) => c.country),
    Uint16Array.from(cities, (c) => c.zone),
    nameEnds,
  ];
  for (const array of typed) {
    const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    sections.push(bytes, Buffer.alloc(pad4(bytes.length)));
  }
  sections.push(Buffer.concat(names));
  return gzipSync(Buffer.concat(sections), { level: 9 });
}

/** Reads the dataset from its gzipped bytes; throws on a file that isn't one (a packaging bug). */
export function decodePlaces(gzipped: Uint8Array): PlacesDataset {
  // A copy at offset 0, so every section can be viewed in place at its 4-byte-aligned offset.
  const raw = new Uint8Array(gunzipSync(gzipped));
  const view = new DataView(raw.buffer);
  if (new TextDecoder().decode(raw.subarray(0, 4)) !== MAGIC) throw new Error('Not a places dataset.');
  const version = view.getUint32(4, true);
  if (version !== PLACES_DATASET_VERSION)
    throw new Error(`Places dataset version ${version} is not supported.`);
  const jsonLength = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(raw.subarray(12, 12 + jsonLength))) as PlacesHeader;
  const n = header.cities;
  let at = 12 + jsonLength;
  at += pad4(at);
  const take = <T>(make: (buffer: ArrayBuffer, offset: number, length: number) => T, bytes: number): T => {
    const array = make(raw.buffer, at, n);
    at += bytes * n;
    at += pad4(at);
    return array;
  };
  const lat = take((b, o, l) => new Int32Array(b, o, l), 4);
  const lon = take((b, o, l) => new Int32Array(b, o, l), 4);
  const id = take((b, o, l) => new Uint32Array(b, o, l), 4);
  const people = take((b, o, l) => new Uint32Array(b, o, l), 4);
  const region = take((b, o, l) => new Uint16Array(b, o, l), 2);
  const country = take((b, o, l) => new Uint8Array(b, o, l), 1);
  const zone = take((b, o, l) => new Uint16Array(b, o, l), 2);
  const nameEnds = take((b, o, l) => new Uint32Array(b, o, l), 4);
  const names = raw.subarray(at);
  const decoder = new TextDecoder();
  return {
    header,
    lat,
    lon,
    id,
    people,
    region,
    country,
    zone,
    nameOf: (i) => decoder.decode(names.subarray(i === 0 ? 0 : nameEnds[i - 1], nameEnds[i])),
  };
}

/** Degrees from a stored coordinate. */
export const degreesOf = (value: number) => value / SCALE;

/** The dataset from its file. Throws when the file is missing or unreadable. */
export function loadPlaces(path: string): PlacesDataset {
  return decodePlaces(readFileSync(path));
}
