// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: a trip's band above its first day in the clip grid (LIB1-PLACE) · system: DESIGN.md v0.7 (type
 *   roles, the icon registry, ghost Button, the Make pages' RenameDialog)
 * the trip's glyph (20 px, ink-3) and its name as an h2 in type-section ("Portugal · Sep 2026", or the name the
 *   person gave it), its days and clips under it in type-meta ink-2 (with "Probably Brazil, Argentina or Chile" for a trip
 *   known only by its time zone), and Rename… (ghost, small) at its end, which opens the rename dialog; writing
 *   the automatic name back gives the trip its automatic name again. It scrolls away; the day heading under it is
 *   what sticks.
 * states: Rename…: default · hover · focus · active (the Button's) · loading (Save spins) · error (the cause in the
 *   dialog) · success (the toast says so, with Undo; the band shows the new name)
 * motion: none of its own (the grid's arrival brings its tiles; the band is words)
 * contrast: the name ink ≥ 7:1, the counts ink-2 ≥ 7:1, the glyph ink-3 is labelled by the name */
import { Trans, useLingui } from '@lingui/react/macro';
import { PLACE_COMMANDS, type Trip } from '@taalcut/core';
import { Button, CONCEPT_ICONS, ICON_SIZE, UserContent, VERB_ICONS } from '@taalcut/ui';
import { useState } from 'react';
import { RenameDialog } from '../../make/rename-dialog';
import { useUndoable } from '../../make/use-undoable';
import { TRIP_BAND } from '../day-layout';
import { HintWords, TripCounts, TripTitle } from './trip-title';
import { tripName } from './trip-words';

export function TripBand({ trip, id }: { trip: Trip; id: string }) {
  const { t, i18n } = useLingui();
  const [renaming, setRenaming] = useState(false);
  const undoable = useUndoable();
  const Glyph = CONCEPT_ICONS.trip;
  const automatic = tripName(i18n, { ...trip, name: null });
  return (
    <div
      data-slot="clip-trip-band"
      className="flex items-end gap-3 px-1 pb-1 [overflow-anchor:none]"
      style={{ height: TRIP_BAND }}
    >
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          <Glyph aria-hidden size={ICON_SIZE.lg} className="shrink-0 text-ink-3" />
          <h2 id={id} className="m-0 min-w-0 truncate type-section text-ink">
            <TripTitle trip={trip} />
          </h2>
        </div>
        <span className="truncate ps-7 type-meta text-ink-2">
          <TripCounts trip={trip} />
          {!trip.place && trip.hint.length > 0 ? (
            <>
              <span aria-hidden> · </span>
              <HintWords countries={trip.hint} />
            </>
          ) : null}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="ms-auto mb-1 shrink-0"
        aria-describedby={id}
        onClick={() => setRenaming(true)}
      >
        <VERB_ICONS.rename aria-hidden />
        {t`Rename…`}
      </Button>
      <RenameDialog
        open={renaming}
        onOpenChange={setRenaming}
        title={t`Rename the trip`}
        label={t`Name`}
        value={trip.name ?? automatic}
        maxLength={120}
        onSave={(next) => {
          // Its automatic name, written back, is the automatic name again: it follows the trip's place.
          const name = next === automatic ? null : next;
          return undoable.run({
            name: PLACE_COMMANDS.renameTrip,
            payload: { tripId: trip.id, name },
            projectId: null,
            done: name ? (
              <Trans>
                Renamed to <UserContent translate="no">{next}</UserContent>
              </Trans>
            ) : (
              <Trans>
                Called <UserContent translate="no">{automatic}</UserContent> again
              </Trans>
            ),
            failed: t`Couldn’t rename the trip`,
          });
        }}
      />
    </div>
  );
}
