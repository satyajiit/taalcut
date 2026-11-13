// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where generated and bundled files enter the library (P3-B6, P3-B7, P3-V6), in the agent and jobs processes:
 * the library's GeneratedAssetSink by core's token, lazy, keeping files under the originals root as the setting
 * names it on each put (library-agent.ts `originalsRoot`). Registering it switches on what waits for it: the
 * image tool (agent-images.ts) and audio's generation services and tools (agent-audio-services.ts).
 */
import { EventBusToken, GeneratedAssetSinkToken, type Container } from '@taalcut/core';
import { createGeneratedAssetSink } from '@taalcut/library';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { originalsRoot } from './library-agent';

export function registerLibraryGenerated(container: Container): void {
  if (container.has(GeneratedAssetSinkToken)) return;
  container.factory(
    GeneratedAssetSinkToken,
    ({ db, events }) => createGeneratedAssetSink(db, { originalsRoot: () => originalsRoot(db), events }),
    { deps: { db: LibraryDatabaseToken, events: EventBusToken } },
  );
}
