// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- error details, entity names and track names as the real handlers write them: data for logs, not UI */

/**
 * P3-V5: the pro export formats (timelines.interchangeFormats), timeline.exportInterchange and Save as… for its
 * file (files.saveExportAs), as the timeline package, the agent's export sink and main answer them. Also the
 * export area's state (export-state.ts) and the commands the export dialog's sections dispatch
 * (fake-export-commands.ts), registered here with this module's commands.
 */
import {
  appContract,
  ConflictError,
  defineCommand,
  err,
  implementContract,
  NotFoundError,
  ok,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  toRpcError,
  type AnyCommand,
  type AssetId,
  type AssetProvenance,
  type ProjectId,
  type TimelineId,
} from '@taalcut/core';
import { timelineError } from '../edits';
import type { MakeP3Deps } from './deps';
import { createFakeExportCommands } from './fake-export-commands';
import { startExportState } from './interchange/export-state';
import { showcaseExport } from './interchange/showcase';
import {
  exportFileName,
  INTERCHANGE_FORMATS_INFO,
  interchangeWarnings,
} from './interchange/interchange-file';

const PROCEDURES = { interchangeFormats: appContract.timelines.interchangeFormats };
const FILE_PROCEDURES = { saveExportAs: appContract.files.saveExportAs };

export function createFakeInterchange(deps: MakeP3Deps) {
  const state = startExportState();
  const os = implementContract(PROCEDURES);
  const router = {
    interchangeFormats: os.interchangeFormats.handler(() => [...INTERCHANGE_FORMATS_INFO]),
  };
  const fs = implementContract(FILE_PROCEDURES);
  /** Save as… for the file timeline.exportInterchange wrote (fake-phase3.ts spreads it into `files`). */
  const files = {
    saveExportAs: fs.saveExportAs.handler(({ input }) => {
      if (!state.files.has(input.fileName))
        throw toRpcError(NotFoundError({ entity: 'export file', id: input.fileName }));
      // Main's save panel, answered with the name it offered.
      return { saved: true, fileName: input.fileName };
    }),
  };

  // The originals the fake library holds; anything else is offline to another editor.
  const online = new Set<AssetId>([...deps.shots.values()].map((shot) => shot.candidate.assetId));
  const exportFile = defineCommand({
    name: TIMELINE_COMMANDS.exportInterchange,
    payload: timelineCommandPayloads[TIMELINE_COMMANDS.exportInterchange],
    sideEffect: 'write',
    project: (p) => p.projectId,
    // Changes nothing in the app: no inverse, nothing to undo.
    handle: (p) => {
      const timeline = deps.timelines.get(p.timelineId);
      if (!timeline || timeline.projectId !== p.projectId)
        return err(timelineError('timeline.not_found', { timelineId: p.timelineId }));
      if (p.revision !== undefined && p.revision !== timeline.revision)
        return err(
          ConflictError(
            { entity: 'timeline', id: p.timelineId },
            { detail: `revision is ${timeline.revision}, not ${p.revision}` },
          ),
        );
      const fileName = exportFileName(
        deps.projects.get(p.projectId)?.name ?? null,
        timeline,
        p.format,
        state.files,
      );
      if (!fileName)
        return err(ConflictError({ entity: 'export file' }, { detail: 'every copy name is taken' }));
      state.files.add(fileName);
      const known = (assetId: AssetId) => online.has(assetId) || state.provenance.has(assetId);
      return ok({ result: { fileName, warnings: interchangeWarnings(timeline, known) } });
    },
  });

  const commands: AnyCommand[] = [exportFile, ...createFakeExportCommands(deps, state)];
  /** For tests: what the library says an asset is (a stock clip, a generated voice), as an import would record. */
  const recordProvenance = (assetId: AssetId, provenance: AssetProvenance) =>
    void state.provenance.set(assetId, provenance);
  /** For tests and screenshots: the timeline with every Phase 3 export part (interchange/showcase.ts). */
  const showcase = (projectId: ProjectId, timelineId: TimelineId) =>
    showcaseExport(deps.timelines, state, [...online], projectId, timelineId);
  return { router, files, commands, recordProvenance, showcase };
}
