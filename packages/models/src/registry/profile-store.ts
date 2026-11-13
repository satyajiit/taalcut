// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where profile state is kept: core's ModelProfileStore port, which
 * packages/library implements on the database (ModelProfile in PRD 6.3) and
 * which commits a command's save with its audit row. The in-memory store
 * serves tests and first runs. The store moves JSON; the profiles service
 * validates it.
 */
import { ok, type CommandContext, type ModelProfileStore } from '@taalcut/core';

export interface MemoryProfileStore extends ModelProfileStore {
  /** The last saved value (a deep copy), for assertions. */
  readonly saved: unknown;
  readonly saves: number;
  /** The command context the last save came with, if any. */
  readonly lastContext: CommandContext | undefined;
}

export function createMemoryProfileStore(initial?: unknown): MemoryProfileStore {
  let saved: unknown = initial === undefined ? undefined : structuredClone(initial);
  let saves = 0;
  let lastContext: CommandContext | undefined;
  return {
    get saved() {
      return saved;
    },
    get saves() {
      return saves;
    },
    get lastContext() {
      return lastContext;
    },
    load: async () => ok(saved === undefined ? undefined : structuredClone(saved)),
    save: async (state, context) => {
      saved = structuredClone(state);
      saves += 1;
      lastContext = context;
      return ok(undefined);
    },
  };
}
