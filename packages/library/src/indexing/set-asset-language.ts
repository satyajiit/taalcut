// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `library.setAssetLanguage` (agent process, LIB1-LANG): the person says what language a clip is in. The choice is
 * stored and wins over detection from then on; `assets.language` becomes it at once, so search and the agent see
 * it; and `audio.language` and `audio.transcript` go back to waiting, so the transcript is made again in that
 * language (a language no engine here writes out, Odia, skips with the honest line). `language: null` gives the
 * clip back to detection. Undoable: the inverse sets the previous choice, and re-runs the same stages.
 * `library.changed` (entity 'asset') goes out once the write has committed.
 */
import {
  createCommitAnnouncer,
  defineCommand,
  err,
  LIBRARY_COMMANDS,
  libraryCommandPayloads,
  NotFoundError,
  ok,
  type AssetId,
  type CommandContext,
  type CommitAnnouncer,
  type Result,
  type SpokenLanguage,
} from '@taalcut/core';
import { eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { CommandUnitOfWork, StagedWrite } from '../ports/unit-of-work';
import { createAssetRepository } from '../repositories/media-library';
import { inTransaction } from '../repositories/shared';
import { assets } from '../schema/library';
import { createAssetLanguageRepository, effectiveOf } from '../speech/asset-language';
import { reindexAssets } from './reindex-command';

export const SET_ASSET_LANGUAGE = LIBRARY_COMMANDS.setAssetLanguage;

/** What a corrected language changes: the decision, then the transcript made in it. */
export const LANGUAGE_STAGES = ['audio.language', 'audio.transcript'] as const;

export interface SetAssetLanguageDeps {
  readonly db: LibraryDatabase;
  /** createLibraryPorts(db).commands: the write commits with the audit entry. */
  readonly commands?: Pick<CommandUnitOfWork, 'stage'>;
}

/** The choice, the effective language and the stages to redo, in one transaction. */
export function setAssetLanguage(
  db: LibraryDatabase,
  assetId: AssetId,
  language: SpokenLanguage | null,
): Result<SpokenLanguage | null> {
  return inTransaction(db, 'asset', () => {
    const record = createAssetLanguageRepository(db).setChosen(assetId, language);
    if (!record.ok) return record;
    const effective = effectiveOf(record.value);
    const filed = createAssetRepository(db).setLanguage(assetId, effective);
    if (!filed.ok) return filed;
    const reset = reindexAssets(db, [assetId], LANGUAGE_STAGES);
    if (!reset.ok) return reset;
    return ok(effective);
  });
}

export function createSetAssetLanguageCommand(deps: SetAssetLanguageDeps) {
  const announcer: CommitAnnouncer = createCommitAnnouncer();
  const write = (context: CommandContext, change: StagedWrite) =>
    deps.commands ? deps.commands.stage(context, change) : change();

  const command = defineCommand({
    name: SET_ASSET_LANGUAGE,
    payload: libraryCommandPayloads[SET_ASSET_LANGUAGE],
    sideEffect: 'write',
    handle: async ({ assetId, language }, context) => {
      const id = assetId as AssetId;
      const known = deps.db.orm.select({ id: assets.id }).from(assets).where(eq(assets.id, id)).get();
      if (!known) return err(NotFoundError({ entity: 'asset', id }));
      const previous = createAssetLanguageRepository(deps.db).get(id).chosen;
      let effective: SpokenLanguage | null = null;
      const staged = write(context, () => {
        const set = setAssetLanguage(deps.db, id, language);
        if (set.ok) effective = set.value;
        return set;
      });
      if (!staged.ok) return staged;
      announcer.note(context, { projectId: null, entity: 'asset', change: 'updated', ids: [id] });
      return ok({
        result: { assetId: id, language, effective },
        inverse: { name: SET_ASSET_LANGUAGE, payload: { assetId: id, language: previous } },
      });
    },
  });

  return {
    command,
    /** Sends `library.changed` for each committed correction (call once with the agent's bus). */
    announce: (
      bus: Parameters<CommitAnnouncer['attach']>[0],
      events: Parameters<CommitAnnouncer['attach']>[1],
    ) => announcer.attach(bus, events),
  };
}
