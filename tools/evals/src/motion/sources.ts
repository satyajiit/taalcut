// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The camera-motion eval set's source photos (FRM1-MOT): CC0 or CC BY photos from Wikimedia Commons, fetched once
 * into the set's folder as Commons' 3840 px thumbnails and never committed. Backgrounds are split by photo, so the
 * held-out clips are made from photos the thresholds never saw. Subject photos give the moving subjects their
 * texture (people in a crowd, a market, a walkway); a person-shaped mask cuts each one out (render.ts).
 *
 * The fetch checks each file's licence on Commons at fetch time and refuses anything but CC0 or CC BY (no SA, no
 * NC): the list is ours, the licence is Commons'.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type SourceRole = 'background' | 'subject';
export type Split = 'train' | 'heldout';

export interface SourceEntry {
  readonly id: string;
  readonly title: string;
  readonly role: SourceRole;
  /** Backgrounds only: which split the clips made from it are in. */
  readonly split?: Split;
}

const bg = (id: string, title: string, split: Split): SourceEntry => ({
  id,
  title,
  role: 'background',
  split,
});
const subject = (id: string, title: string): SourceEntry => ({ id, title, role: 'subject' });

export const SOURCES: readonly SourceEntry[] = [
  bg('lime-street', 'File:Lime Street buildings, City of London.jpg', 'train'),
  bg('hk-market', 'File:Evening market in Hong Kong.jpg', 'train'),
  bg('mountains', 'File:Mountains Landscape.jpg', 'train'),
  bg('parasols', 'File:Parasols, Evening, Beach, Rincon de la Victoria, Andalusia, Spain.jpg', 'train'),
  bg(
    'living-room',
    'File:Living room in apartment of Condomínio do Edifício Zaher, Le Blond, Rio de Janeiro, Brazil.jpg',
    'train',
  ),
  bg('city-lights', 'File:City of lights (Unsplash).jpg', 'train'),
  bg('farm-field', 'File:Field-agriculture-farm-grass (23697661484).jpg', 'train'),
  bg('york-platform', 'File:Platform 1 York railway station Oct24.jpg', 'train'),
  bg('itsukushima', 'File:20181111 Itsukushima Shrine temple-1.jpg', 'train'),
  bg('nymans-kitchen', 'File:Kitchen, Nymans House 2026-07-31.jpg', 'train'),
  bg('murghab-market', 'File:Murghab market 2.jpg', 'train'),
  bg('snow-cemetery', 'File:Snow-covered Saint-Charles Cemetery 6.jpg', 'train'),
  bg('taco-stall', 'File:Street taco stall in Mexico City.jpg', 'train'),
  bg('snowy-street', 'File:Bike on a snowy street in Quebec City at night.jpg', 'train'),
  bg(
    'fishing-boats',
    'File:Fishing boats, morning, Beach, Rincon de la Victoria, Andalusia, Spain.jpg',
    'train',
  ),
  bg('budapest-street', 'File:Budapest 20260412 223221.jpg', 'train'),
  bg('frontenac', 'File:Chateau Frontenac at dusk in Quebec City.jpg', 'heldout'),
  bg('takanawa', 'File:Takanawa Gateway Station Keihin Tohoku Line Platform at night.jpg', 'heldout'),
  bg('greek-lake', 'File:Scenic landscape of Greek mountains and lake.jpg', 'heldout'),
  bg(
    'dining-room',
    "File:Dining room at the inn Dans les bras de Morphée, located on Île d'Orléans.jpg",
    'heldout',
  ),
  bg('tanay-market', 'File:1359Tanay Public Market 01.jpg', 'heldout'),
  bg('grass-valley', 'File:Grass Valley, United States (Unsplash).jpg', 'heldout'),
  bg(
    'nara-temple',
    'File:Temple building, shrine, Rōben Sugi and deer below Nigatsu-dō, Tōdai-ji, Nara, 2016.jpg',
    'heldout',
  ),
  bg('shibuya-snow', 'File:February 2024, snow in Shibuya-ku.jpg', 'heldout'),
  subject('station-crowd', 'File:Train station crowd in black and white (Unsplash).jpg'),
  subject('brooklyn-walkway', 'File:BrooklynBridgeWalkwayCrowd.jpg'),
  subject(
    'wading-couple',
    'File:Couple wading beside fishing boats at Juan Griego Beach, Margarita Island, Venezuela.jpg',
  ),
  subject('tanay-stalls', 'File:1359Tanay Public Market 04.jpg'),
  subject('budapest-crowd', 'File:Budapest 20260412 223354.jpg'),
  subject('hikers', 'File:Landscape-mountains-nature-people (24216397892).jpg'),
];

export interface FetchedSource {
  readonly id: string;
  readonly title: string;
  readonly role: SourceRole;
  readonly split?: Split;
  readonly page: string;
  readonly author: string;
  readonly licence: string;
  readonly licenceUrl: string | null;
  /** The thumbnail kept (Commons' 3840 px one), inside the set's folder. */
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
}

/** A plain identifier: no personal details. */
const USER_AGENT = 'TaalcutEval/1.0 (camera-motion eval set builder)';
const API = 'https://commons.wikimedia.org/w/api.php';
const THUMB_WIDTH = 3840;

/** CC0 and plain CC BY (any version) only: never SA or NC. */
export function licenceAllowed(short: string): boolean {
  if (short === 'CC0') return true;
  return /^CC BY( \d(\.\d)?)?$/.test(short.trim());
}

const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

interface ImageInfo {
  readonly thumburl?: string;
  readonly thumbwidth?: number;
  readonly thumbheight?: number;
  readonly descriptionurl: string;
  readonly extmetadata?: Record<string, { readonly value?: string }>;
}

/** A GET that waits and tries again when Commons asks a client to slow down (429, 503). */
async function politeFetch(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if ((response.status !== 429 && response.status !== 503) || attempt >= 6) return response;
    const after = Number(response.headers.get('retry-after'));
    await new Promise((resolve) =>
      setTimeout(resolve, (Number.isFinite(after) && after > 0 ? after : 5 * (attempt + 1)) * 1000),
    );
  }
}

async function imageInfo(title: string): Promise<ImageInfo> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: 'LicenseShortName|Artist|LicenseUrl',
  });
  const response = await politeFetch(`${API}?${params}`);
  if (!response.ok) throw new Error(`Commons said ${response.status} for ${title}`);
  const body = (await response.json()) as {
    query?: { pages?: Record<string, { imageinfo?: ImageInfo[] }> };
  };
  const page = Object.values(body.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info) throw new Error(`Commons has no file ${title}`);
  return info;
}

/** Fetches every source not yet in `dir` (re-checking the licence of each), and returns them all. */
export async function fetchSources(
  dir: string,
  log: (line: string) => void = () => {},
): Promise<FetchedSource[]> {
  const indexPath = join(dir, 'sources.json');
  const known = new Map<string, FetchedSource>(
    existsSync(indexPath)
      ? (JSON.parse(readFileSync(indexPath, 'utf8')) as FetchedSource[]).map((s) => [s.id, s])
      : [],
  );
  const out: FetchedSource[] = [];
  for (const entry of SOURCES) {
    const have = known.get(entry.id);
    if (have && existsSync(join(dir, have.file))) {
      out.push(have);
      continue;
    }
    const info = await imageInfo(entry.title);
    const licence = info.extmetadata?.LicenseShortName?.value ?? '';
    if (!licenceAllowed(licence))
      throw new Error(`${entry.title} is ${licence || 'unlicensed'}: not CC0 or CC BY`);
    if (!info.thumburl) throw new Error(`Commons gave no thumbnail for ${entry.title}`);
    const image = await politeFetch(info.thumburl);
    if (!image.ok) throw new Error(`Commons said ${image.status} for ${entry.title}'s thumbnail`);
    const bytes = new Uint8Array(await image.arrayBuffer());
    const file = `${entry.id}.jpg`;
    writeFileSync(join(dir, file), bytes);
    const fetched: FetchedSource = {
      id: entry.id,
      title: entry.title,
      role: entry.role,
      ...(entry.split ? { split: entry.split } : {}),
      page: info.descriptionurl,
      author: plain(info.extmetadata?.Artist?.value ?? 'unknown'),
      licence,
      licenceUrl: info.extmetadata?.LicenseUrl?.value ?? null,
      file,
      width: info.thumbwidth ?? 0,
      height: info.thumbheight ?? 0,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    log(`fetched ${entry.id} (${licence}, ${Math.round(bytes.length / 1024)} KiB)`);
    out.push(fetched);
    known.set(entry.id, fetched);
    writeFileSync(indexPath, `${JSON.stringify([...known.values()], null, 2)}\n`);
    // Commons asks for gentle clients.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  writeFileSync(indexPath, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}
