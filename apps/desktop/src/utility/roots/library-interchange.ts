// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's originals for pro export (P3-V5) in the agent process: core's InterchangeMediaSource, which
 * `timeline.exportInterchange` reads with the exports folder's ExportFileSink (agent-timeline.ts). Register it
 * before the timeline commands are built; lazy, so nothing opens until an export asks.
 */
import { InterchangeMediaSourceToken, type Container } from '@taalcut/core';
import { createInterchangeMediaSource } from '@taalcut/library';
import { LibraryDatabaseToken } from '../../shared/tokens';

export function registerInterchangeMediaSource(container: Container): void {
  if (container.has(InterchangeMediaSourceToken)) return;
  container.factory(InterchangeMediaSourceToken, ({ db }) => createInterchangeMediaSource(db), {
    deps: { db: LibraryDatabaseToken },
  });
}
