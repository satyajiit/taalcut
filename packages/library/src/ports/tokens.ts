// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's own DI tokens. Composition roots register the database
 * (main opens and migrates it; utility processes open it lazily) and one
 * createLibraryPorts(db) per process, then each port under core's token.
 */
import { createToken } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { LibraryPorts } from './index';
import type { CommandUnitOfWork } from './unit-of-work';

export const LibraryDatabaseToken = createToken<LibraryDatabase>('library.database');
/** createLibraryPorts(db): once per process, because the unit of work holds staged writes. */
export const LibraryPortsToken = createToken<LibraryPorts>('library.ports');
/**
 * Where command handlers stage their writes: `stage(context, write)` returns a
 * Result, and a handler that stages is wrapped in `handle(…)` so a failure
 * discards what it staged.
 */
export const CommandUnitOfWorkToken = createToken<CommandUnitOfWork>('library.commandUnitOfWork');
