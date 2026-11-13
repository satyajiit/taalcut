// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Places and trips (LIB1-PLACE). A clip's place is named on this Mac from GeoNames' cities (CC-BY 4.0): its own
 * coordinates ('gps'), a clip from the same source shot within hours that has coordinates ('nearby'), or only the UTC
 * offset it was shot at, which names the countries it probably was in ('zone', a hint never shown as fact). Trips are
 * the library's clips grouped by capture time and place: away from the person's usual place, split by gaps of more
 * than two days, named by place and month unless the person renamed them (`library.renameTrip`).
 *
 * Names are plain text from the dataset (a city as GeoNames writes it, Latin script); a country is its ISO 3166-1
 * code, which a window names in its own language (Intl.DisplayNames). Coordinates never leave this Mac: these
 * schemas carry names only.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { CAPTURE_OFFSET_FROM, CAPTURE_OFFSET_MAX, CAPTURE_OFFSET_MIN } from '../analysis/media-facts';
import { idSchema, type Id } from '../basics/ids';
import { ipc } from '../ipc/contract';

export type TripId = Id<'Trip'>;
export const tripIdSchema = idSchema<'Trip'>();

/** ISO 3166-1 alpha-2, upper case ("VN"). */
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

/** How a clip's place was found. */
export const PLACE_BASES = ['gps', 'nearby', 'zone'] as const;
export type PlaceBasis = (typeof PLACE_BASES)[number];

/** The most countries a time-zone hint names. */
export const PLACE_HINT_MAX = 3;

const name = z.string().min(1).max(200);
const epochMs = z.int().nonnegative();

/** A city from the dataset: where a clip with coordinates (its own or a neighbour's) was shot. */
const namedPlace = {
  /** GeoNames' id for the city: stable across dataset updates. */
  cityId: z.int().positive(),
  city: name,
  /** Its first-level region (state, province), when the dataset names one. */
  region: name.nullable(),
  country: countryCodeSchema,
  /** How far the coordinates were past the city's edge, in whole kilometres ("near Sintra" past 15). */
  km: z.int().nonnegative().max(1000),
};

export const placeSchema = z.discriminatedUnion('basis', [
  z.object({ basis: z.literal('gps'), ...namedPlace }),
  z.object({
    basis: z.literal('nearby'),
    ...namedPlace,
    /** The clip whose coordinates it borrowed: same source, shot within hours. */
    from: idSchema<'Asset'>(),
    /** How far apart in time the two were shot. */
    apartMs: epochMs,
  }),
  z.object({
    basis: z.literal('zone'),
    /** The UTC offset it was shot at, minutes east of UTC. 0 is UTC itself (Lisbon or London in winter). */
    offsetMin: z.int().min(CAPTURE_OFFSET_MIN).max(CAPTURE_OFFSET_MAX),
    /** Where the offset came from (LIB1-OEM's captureOffset): the file, or a clip shot nearby. */
    offsetFrom: z.enum(CAPTURE_OFFSET_FROM),
    /** The countries that keep that offset at that moment, the likeliest first (by population). */
    countries: z.array(countryCodeSchema).min(1).max(PLACE_HINT_MAX),
  }),
]);
export type Place = z.output<typeof placeSchema>;

/** What a trip's automatic name says before its month: a city, a region, or up to three countries. */
export const tripPlaceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('city'), name, country: countryCodeSchema }),
  z.object({ kind: z.literal('region'), name, country: countryCodeSchema }),
  z.object({ kind: z.literal('countries'), countries: z.array(countryCodeSchema).min(1).max(3) }),
]);
export type TripPlace = z.output<typeof tripPlaceSchema>;

/** A trip's name as the person gave it. */
export const tripNameSchema = z.string().trim().min(1).max(120);

export const tripSchema = z.object({
  id: tripIdSchema,
  /** The person's name for it; null: the automatic one, `place` and `month` in words ("Lisbon · Mar 2026"). */
  name: tripNameSchema.nullable(),
  /** null when no clip of it has a place, only a time-zone hint. */
  place: tripPlaceSchema.nullable(),
  /** Without a place: the countries its clips' time zone names, likeliest first ("probably"). */
  hint: z.array(countryCodeSchema).max(PLACE_HINT_MAX),
  /** The month it started, on the trip's own calendar ("2026-10"). */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  startedAt: epochMs,
  endedAt: epochMs,
  clips: z.int().positive(),
  /** Calendar days with a clip, on the trip's own calendar. */
  days: z.int().positive(),
});
export type Trip = z.output<typeof tripSchema>;

/** The `library.place` index stage: names the asset's own place (its coordinates, or its time zone as a hint). */
export const PLACE_STAGE = 'library.place';

/**
 * The stage's stored output: the asset's own evidence only ('gps' or 'zone'; 'nearby' is the library's later
 * guess and isn't stored per stage), or null when nothing says. Stages that read `library.place` (descriptions'
 * context) get it from the view with `storedPlace`.
 */
export const placeStageOutputSchema = z.object({ place: placeSchema.nullable() });
export type PlaceStageOutput = z.output<typeof placeStageOutputSchema>;

/** The asset's own place as `library.place` stored it; null before it ran or when nothing says. */
export function storedPlace(view: { readonly outputs: Readonly<Record<string, unknown>> }): Place | null {
  const parsed = placeStageOutputSchema.safeParse(view.outputs[PLACE_STAGE]);
  return parsed.success ? parsed.data.place : null;
}

function countryName(code: string, names: Intl.DisplayNames | null): string {
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * A place in a few words for a model's context or a tool's output, in `locale` (default English): "Lisbon,
 * Portugal", "near Sintra, Lisbon, Portugal", "probably Brazil, Argentina or Chile (from its time zone)". Never shown
 * in the window, which words its own.
 */
export function placeInWords(place: Place, locale = 'en'): string {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    names = null;
  }
  if (place.basis === 'zone') {
    const countries = place.countries.map((code) => countryName(code, names));
    const list =
      countries.length > 1
        ? `${countries.slice(0, -1).join(', ')} or ${countries[countries.length - 1]}`
        : countries[0];
    return `probably ${list} (from its time zone)`;
  }
  const parts = [place.city, place.region, countryName(place.country, names)].filter(
    (part, i, all): part is string => part !== null && all.indexOf(part) === i,
  );
  const near = place.km > 15 || place.basis === 'nearby' ? 'near ' : '';
  return `${near}${parts.join(', ')}`;
}

/** Place and trip commands (handlers in @taalcut/library, agent process). */
export const PLACE_COMMANDS = {
  /** write, undoable: names a trip, or with `name: null` gives it back its automatic name. */
  renameTrip: 'library.renameTrip',
} as const;

export const placeCommandPayloads = {
  [PLACE_COMMANDS.renameTrip]: z.object({ tripId: tripIdSchema, name: tripNameSchema.nullable() }),
};

/** A place the library has clips in, for filters: a country, or a city in it. */
export const placeCountSchema = z.object({
  country: countryCodeSchema,
  /** null: the country as a whole. */
  cityId: z.int().positive().nullable(),
  city: name.nullable(),
  region: name.nullable(),
  /** Clips there, by their own or a neighbour's coordinates (not hints). */
  clips: z.int().positive(),
});
export type PlaceCount = z.output<typeof placeCountSchema>;

/**
 * The reads `appContract.library` adds for places (owner agent): every trip, newest first, and the countries and
 * cities the library has clips in, most clips first.
 */
export const placeQueries = {
  trips: ipc.output(z.object({ trips: z.array(tripSchema).max(1000) })),
  places: ipc.output(z.object({ places: z.array(placeCountSchema).max(2000) })),
};
