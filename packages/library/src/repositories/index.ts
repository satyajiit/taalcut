// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { LibraryDatabase } from '../db/database';
import { createAssetLocationRepository, type AssetLocationRepository } from './asset-locations';
import { createDerivedFileRepository, type DerivedFileRepository } from './derived-files';
import { createShotRepository, type ShotRepository } from './shots';
import { createTranscriptRepository, type TranscriptRepository } from './transcripts';
import { createAuditLogRepository, type AuditLogRepository } from './audit-log';
import { createChatRepository, type ChatRepository } from './chat';
import { createJobRepository, type JobLeaseRepository } from './jobs';
import { createAssetRepository, type AssetRepository } from './media-library';
import { createSourceRepository, type SourceRepository } from './sources';
import {
  createCloudCallRepository,
  createModelProfileStateRepository,
  type CloudCallRepository,
  type ModelProfileStateRepository,
} from './models';
import {
  createConversationRepository,
  createProjectRepository,
  type ConversationRepository,
  type ProjectRepository,
} from './projects';
import {
  createAcknowledgementRepository,
  createSettingsRepository,
  type AcknowledgementRepository,
  type SettingsRepository,
} from './settings';
import { createRunLogRepository, type RunLogRepository } from './run-log';
import { createToolRunRepository, type ToolRunRepository } from './tool-runs';
import { createTraceRepository, type TraceRepository } from './traces';
import { createUsageRepository, type UsageRepository } from './usage';

export interface Repositories {
  readonly projects: ProjectRepository;
  readonly conversations: ConversationRepository;
  /** The chat read model and soft archive/delete over conversations. */
  readonly chat: ChatRepository;
  readonly toolRuns: ToolRunRepository;
  readonly auditLog: AuditLogRepository;
  readonly runLog: RunLogRepository;
  readonly jobs: JobLeaseRepository;
  readonly modelProfileState: ModelProfileStateRepository;
  readonly acknowledgements: AcknowledgementRepository;
  readonly settings: SettingsRepository;
  readonly cloudCalls: CloudCallRepository;
  readonly usage: UsageRepository;
  readonly traces: TraceRepository;
  /** Provisional (ADR 0001). */
  readonly sources: SourceRepository;
  /** Provisional (ADR 0001). */
  readonly assets: AssetRepository;
  /** Provisional (ADR 0001). */
  readonly assetLocations: AssetLocationRepository;
  /** Provisional (ADR 0001). Analyses, descriptions and near-duplicate groups (P2-L1). */
  readonly shots: ShotRepository;
  readonly transcripts: TranscriptRepository;
  readonly derivedFiles: DerivedFileRepository;
}

/**
 * Every synchronous repository over one database connection. Cheap:
 * repositories hold no state. Core's async ports are in ../ports.
 */
export function createRepositories(db: LibraryDatabase): Repositories {
  return {
    projects: createProjectRepository(db),
    conversations: createConversationRepository(db),
    chat: createChatRepository(db),
    toolRuns: createToolRunRepository(db),
    auditLog: createAuditLogRepository(db),
    runLog: createRunLogRepository(db),
    jobs: createJobRepository(db),
    modelProfileState: createModelProfileStateRepository(db),
    acknowledgements: createAcknowledgementRepository(db),
    settings: createSettingsRepository(db),
    cloudCalls: createCloudCallRepository(db),
    usage: createUsageRepository(db),
    traces: createTraceRepository(db),
    sources: createSourceRepository(db),
    assets: createAssetRepository(db),
    assetLocations: createAssetLocationRepository(db),
    shots: createShotRepository(db),
    transcripts: createTranscriptRepository(db),
    derivedFiles: createDerivedFileRepository(db),
  };
}

export * from './asset-facts';
export * from './asset-locations';
export * from './asset-removal';
export * from './derived-files';
export * from './audit-log';
export * from './chat';
export * from './jobs';
export * from './media-library';
export * from './models';
export * from './projects';
export * from './run-log';
export * from './settings';
export * from './shots';
export * from './sources';
export * from './stored-time';
export * from './tool-runs';
export * from './traces';
export * from './transcript-text';
export * from './transcripts';
export * from './usage';
