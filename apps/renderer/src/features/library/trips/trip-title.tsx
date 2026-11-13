// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: a trip's name and its counts in words (LIB1-PLACE) · system: DESIGN.md v0.7 (type roles)
 * the person's name for the trip as they wrote it, else the automatic one: the place ("Goa", "Portugal and
 *   Spain") or "Trip", then its month ("Mar 2026"). Place names and the month are data (translate="no", a
 *   <time>), the words around them the catalogue's. The counts: "3 days · 12 clips", and a hint for a trip known
 *   only by its time zone ("Probably Brazil, Argentina or Chile").
 * states: none of its own (words) */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { Trip } from '@taalcut/core';
import { UserContent } from '@taalcut/ui';
import { countryList, tripMonth, tripPlaceWords } from './trip-words';

export function TripTitle({ trip }: { trip: Pick<Trip, 'name' | 'place' | 'month'> }) {
  const { i18n } = useLingui();
  if (trip.name) return <UserContent translate="no">{trip.name}</UserContent>;
  const month = <time dateTime={trip.month}>{tripMonth(i18n, trip.month)}</time>;
  if (!trip.place) return <Trans>Trip · {month}</Trans>;
  const place = <span translate="no">{tripPlaceWords(i18n, trip.place)}</span>;
  return (
    <Trans>
      {place} · {month}
    </Trans>
  );
}

export function TripCounts({ trip }: { trip: Pick<Trip, 'days' | 'clips'> }) {
  return (
    <span className="tabular-nums">
      <Plural value={trip.days} one="# day" other="# days" />
      <span aria-hidden> · </span>
      <Plural value={trip.clips} one="# clip" other="# clips" />
    </span>
  );
}

/** "Probably Brazil, Argentina or Chile": a trip, or a clip, known only by its time zone. */
export function HintWords({ countries }: { countries: readonly string[] }) {
  const { i18n } = useLingui();
  const names = <span translate="no">{countryList(i18n, countries, true)}</span>;
  return <Trans>Probably {names}</Trans>;
}
