// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's Phase 3 stores per utility process (contract P3-1, packages/library SPEC "Phase 3"). Each process
 * registers them right after its Phase 2 library stores and before the wiring that checks for them with
 * `container.has`: the agent's timeline, audio, images, templates, styles and hub; the render process's Style; the
 * jobs process's generated-asset sink. Every store is lazy: nothing opens until something resolves it.
 */
import type { AssetId, Container } from '@taalcut/core';
import { createProvenanceLookup } from '@taalcut/library';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { registerLibraryGenerated } from './library-generated';
import { registerLibraryHub } from './library-hub';
import { registerInterchangeMediaSource } from './library-interchange';
import { registerLibraryTemplateStores } from './library-templates';
import { registerLibraryVoice } from './library-voice';

type Config = Pick<UtilityConfig, 'userData'>;

/** Folders and Styles, the hub's cache and submissions, voice consents, the generated sink, pro export's media. */
export function registerLibraryPhase3Agent(container: Container, config: Config): void {
  registerLibraryTemplateStores(container, config);
  registerLibraryHub(container);
  registerLibraryVoice(container, config);
  registerLibraryGenerated(container);
  registerInterchangeMediaSource(container);
}

/** The Style a render draws (render-phase3.ts `styles`). */
export function registerLibraryPhase3Render(container: Container, config: Config): void {
  registerLibraryTemplateStores(container, config);
}

/** Generated files kept by jobs (library-jobs.ts prunes unused Style logos in `library.collect` itself). */
export function registerLibraryPhase3Jobs(container: Container): void {
  registerLibraryGenerated(container);
}

/** Where an asset came from (render's AI inventory and disclosure reminders), read from this process's library. */
export function libraryProvenance(container: Container) {
  return (assetId: AssetId) => createProvenanceLookup(container.resolve(LibraryDatabaseToken))(assetId);
}
