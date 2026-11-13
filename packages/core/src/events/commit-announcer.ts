// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.changed` sent only once a command commits (library SPEC, "sent only after commit"; round P3-3). A
 * store stages its writes with the command's audit row, so a handler that announced itself would wake a watcher
 * (an open timeline, the projects list) before the rows exist, and would tell it about a change a failed append
 * then threw away. The handler notes what it changed under its command id instead; the bus listener sends the
 * notes once the audit row is durable: executed, undone or redone. A note whose command never commits is
 * dropped, and at most `maxPending` uncommitted notes are kept (the oldest goes first).
 *
 * One helper for the library's project commands, the timeline's commands and audio's timeline writes, which
 * each kept a copy.
 */
import type { CommandId } from '../basics/ids';
import type { CommandBus } from '../commands/bus-types';
import type { CommandContext } from '../commands/definition';
import type { EventBus } from './bus';
import type { EventPayload } from './catalogue';

/** What a handler changed: a `library.changed` payload, sent once its command commits. */
export type CommittedChange = Omit<EventPayload<'library.changed'>, 'ids'> & {
  readonly ids: readonly string[];
};

export interface CommitAnnouncer {
  /** Notes a change under the command's id; sent once the command commits, dropped if it never does. */
  note(context: Pick<CommandContext, 'commandId'>, change: CommittedChange): void;
  /** Forgets the command's notes (its handler failed after noting). */
  drop(context: Pick<CommandContext, 'commandId'>): void;
  /** Sends each committed command's notes as `library.changed`, in the order noted. Returns the unsubscribe. */
  attach(bus: Pick<CommandBus, 'subscribe'>, events: Pick<EventBus, 'emit'>): () => void;
}

export const COMMIT_ANNOUNCER_MAX_PENDING = 256;

export function createCommitAnnouncer(options: { readonly maxPending?: number } = {}): CommitAnnouncer {
  const maxPending = options.maxPending ?? COMMIT_ANNOUNCER_MAX_PENDING;
  if (!Number.isInteger(maxPending) || maxPending < 1)
    throw new RangeError(`maxPending must be a positive integer, got ${maxPending}`);
  // Insertion order is age order: a command noted again moves to the back.
  const pending = new Map<CommandId, CommittedChange[]>();
  return {
    note({ commandId }, change) {
      const notes = pending.get(commandId) ?? [];
      pending.delete(commandId);
      pending.set(commandId, [...notes, { ...change, ids: [...change.ids] }]);
      for (const oldest of pending.keys()) {
        if (pending.size <= maxPending) break;
        pending.delete(oldest);
      }
    },
    drop({ commandId }) {
      pending.delete(commandId);
    },
    attach(bus, events) {
      return bus.subscribe(({ id }) => {
        const notes = pending.get(id);
        if (!notes) return;
        pending.delete(id);
        for (const note of notes) events.emit('library.changed', { ...note, ids: [...note.ids] });
      });
    },
  };
}
