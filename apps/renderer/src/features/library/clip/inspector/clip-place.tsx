// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: where a clip was shot, in its facts' "When and where" (LIB1-PLACE) · system: DESIGN.md v0.7 (ListRow
 *   dense static rows, the icon registry, type roles)
 * up to three rows, each led by its glyph:
 *   the place, named on this Mac from GeoNames: its own coordinates' city ("Lisbon"; "Near Sintra" past 15 km), its
 *     region and country under it with the coordinates; a neighbour's city as a guess ("Probably Lisbon", "From a
 *     clip filmed 40 minutes apart"); or only its time zone's countries ("Probably Brazil, Argentina or Chile",
 *     "From the phone's time zone, UTC−3"). Coordinates without a city stand alone, as before.
 *   the place the describing model named ("Palolem beach"), with the AI mark, when it says more than the city.
 *   the trip it is part of: its name and its days and clips.
 * states: a city · a guess from a neighbour · a time-zone hint · coordinates only · the model's place · a trip ·
 *   none (nothing renders) · rows: not interactive (static, no hover or focus)
 * motion: none of its own (the inspector's cascade brings it in)
 * contrast: values ink ≥ 7:1, qualifiers ink-2 ≥ 7:1; icons are labelled by their words */
import { Trans, useLingui } from '@lingui/react/macro';
import type { AssetDetail } from '@taalcut/core';
import { AiMark, CONCEPT_ICONS, UserContent } from '@taalcut/ui';
import { formatDuration } from '../../../shared/format';
import { HintWords, TripCounts, TripTitle } from '../../trips/trip-title';
import { countryName, offsetWords } from '../../trips/trip-words';
import { coordinatesOf } from '../clip-facts-data';
import { Fact, Lead } from './fact-row';

function useCoordinates(detail: AssetDetail): string | null {
  const { t, i18n } = useLingui();
  const where = coordinatesOf(detail.facts?.location);
  if (!where) return null;
  const degrees = (value: number) => i18n.number(value, { maximumFractionDigits: 3 });
  const latitude = degrees(where.latitude);
  const longitude = degrees(where.longitude);
  return `${where.north ? t`${latitude}° N` : t`${latitude}° S`}, ${where.east ? t`${longitude}° E` : t`${longitude}° W`}`;
}

/** The place row: a city, a neighbour's city or a time-zone hint; else the bare coordinates; else nothing. */
function PlaceRow({ detail }: { detail: AssetDetail }) {
  const { i18n } = useLingui();
  const place = detail.asset.place ?? null;
  const coordinates = useCoordinates(detail);
  const tabular = coordinates ? <span className="tabular-nums">{coordinates}</span> : null;
  if (!place)
    return coordinates ? (
      <Fact leading={CONCEPT_ICONS.place} title={<span className="tabular-nums">{coordinates}</span>} />
    ) : null;
  if (place.basis === 'zone') {
    const offset = <span translate="no">{offsetWords(place.offsetMin)}</span>;
    return (
      <Fact
        leading={CONCEPT_ICONS.place}
        title={<HintWords countries={place.countries} />}
        meta={
          place.offsetFrom === 'file' ? (
            <Trans>From the phone’s time zone, {offset}</Trans>
          ) : (
            <Trans>From the time zone of a clip filmed nearby, {offset}</Trans>
          )
        }
      />
    );
  }
  const city = <UserContent translate="no">{place.city}</UserContent>;
  const region = place.region && place.region !== place.city ? place.region : null;
  const country = countryName(i18n, place.country);
  const where = <span translate="no">{region ? `${region}, ${country}` : country}</span>;
  const apart = (
    <span translate="no">{formatDuration(i18n, place.basis === 'nearby' ? place.apartMs : 0)}</span>
  );
  return (
    <Fact
      leading={CONCEPT_ICONS.place}
      title={
        place.basis === 'nearby' ? (
          <Trans>Probably {city}</Trans>
        ) : place.km > 15 ? (
          <Trans>Near {city}</Trans>
        ) : (
          city
        )
      }
      meta={
        <span className="flex flex-wrap gap-x-1.5">
          {where}
          {place.basis === 'nearby' ? (
            <>
              <span aria-hidden>·</span>
              <span>
                <Trans>From a clip filmed {apart} apart</Trans>
              </span>
            </>
          ) : tabular ? (
            <>
              <span aria-hidden>·</span>
              {tabular}
            </>
          ) : null}
        </span>
      }
    />
  );
}

export function ClipPlace({ detail }: { detail: AssetDetail }) {
  const { t } = useLingui();
  const place = detail.asset.place ?? null;
  const trip = detail.asset.trip ?? null;
  const described =
    detail.shots.map((shot) => shot.analysis?.description?.place).find((named) => named) ?? null;
  // The model's place says something only when it isn't the city the dataset already named.
  const city = place && place.basis !== 'zone' ? place.city : null;
  const seen = described && described.trim().toLowerCase() !== city?.toLowerCase() ? described : null;
  return (
    <>
      <PlaceRow detail={detail} />
      {seen ? (
        <Fact
          leading={
            <Lead>
              <AiMark className="size-3.5 shrink-0" label={t`Named by Taalcut`} />
            </Lead>
          }
          title={<UserContent translate="no">{seen}</UserContent>}
          meta={t`What Taalcut saw in it`}
        />
      ) : null}
      {trip ? (
        <Fact
          leading={CONCEPT_ICONS.trip}
          title={<TripTitle trip={trip} />}
          // The place row above already says what the trip's time zone suggests.
          meta={<TripCounts trip={trip} />}
        />
      ) : null}
    </>
  );
}
