// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.renameTrip` (LIB1-PLACE, agent process): the person's name for a trip, or with `name: null` its
 * automatic one again. Undoable (its inverse puts the old name back). The trip's clips find it by the new name: their
 * search words are rewritten in the same transaction, and `library.changed` names them once the command commits.
 */
import {
  createCommitAnnouncer,
  defineCommand,
  err,
  NotFoundError,
  ok,
  PLACE_COMMANDS,
  placeCommandPayloads,
  type CommandBus,
  type CommandContext,
  type CommandHandler,
  type EventBus,
  type Result,
  type TripId,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { CommandUnitOfWork, StagedWrite } from '../ports/unit-of-work';
import { readPlace, readTrip, tripMembers } from '../repositories/places';
import { inTransaction } from '../repositories/shared';
import { assetSearchText } from './search-text';

const RENAME = PLACE_COMMANDS.renameTrip;

export interface PlaceCommandDeps {
  readonly db: LibraryDatabase;
  /** createLibraryPorts(db).commands: the write commits with the audit row. */
  readonly commands?: Pick<CommandUnitOfWork, 'stage' | 'handle'>;
  readonly clock?: () => number;
}

/** Names the trip and rewrites its clips' search words. */
export function renameTrip(
  db: LibraryDatabase,
  tripId: TripId,
  name: string | null,
  at: number,
): Result<void> {
  return inTransaction(db, 'trip', () => {
    const row = db.driver
      .prepare(
        `SELECT id, name, place, hint, month, started_at AS startedAt, ended_at AS endedAt, clips, days
         FROM trips WHERE id = ?`,
      )
      .get(tripId);
    const trip = row ? readTrip(row as never) : null;
    if (!trip) return err(NotFoundError({ entity: 'trip', id: tripId }));
    const named = { name, place: trip.place, hint: trip.hint };
    db.driver
      .prepare('UPDATE trips SET name = ?, search_text = ?, updated_at = ? WHERE id = ?')
      .run(name, assetSearchText(null, named), at, tripId);
    const words = db.driver.prepare(
      'UPDATE asset_places SET search_text = ?, updated_at = ? WHERE asset_id = ?',
    );
    const members = db.driver.prepare('SELECT asset_id AS id, place FROM asset_places WHERE trip_id = ?');
    for (const member of members.all(tripId))
      words.run(assetSearchText(readPlace(member.place), named), at, String(member.id));
    return ok(undefined);
  });
}

export function createPlaceCommands(deps: PlaceCommandDeps) {
  const { db } = deps;
  const clock = deps.clock ?? Date.now;
  const announcer = createCommitAnnouncer();
  const guard = <P, R>(handler: CommandHandler<P, R>): CommandHandler<P, R> =>
    deps.commands ? deps.commands.handle(handler) : handler;
  const write = (context: CommandContext, change: StagedWrite) =>
    deps.commands ? deps.commands.stage(context, change) : inTransaction(db, 'trip', change);

  const rename = defineCommand({
    name: RENAME,
    payload: placeCommandPayloads[RENAME],
    sideEffect: 'write',
    handle: guard(async (payload, context) => {
      const before = db.driver.prepare('SELECT name FROM trips WHERE id = ?').get(payload.tripId);
      if (!before) return err(NotFoundError({ entity: 'trip', id: payload.tripId }));
      const was = (before.name as string | null) ?? null;
      const staged = write(context, () => renameTrip(db, payload.tripId, payload.name, clock()));
      if (!staged.ok) return staged;
      const ids = tripMembers(db, payload.tripId);
      for (let i = 0; i < ids.length; i += 1000)
        announcer.note(context, {
          projectId: null,
          entity: 'asset',
          change: 'updated',
          ids: ids.slice(i, i + 1000),
        });
      return ok({
        result: { tripId: payload.tripId, name: payload.name },
        inverse: { name: RENAME, payload: { tripId: payload.tripId, name: was } },
      });
    }),
  });

  return {
    all: [rename],
    renameTrip: rename,
    /** Sends `library.changed` for each committed rename (its clips' summaries changed). */
    announce: (bus: Pick<CommandBus, 'subscribe'>, events: Pick<EventBus, 'emit'>) =>
      announcer.attach(bus, events),
  };
}
