// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Library's implementations of core's persistence ports, ready to register in
 * a composition root (one createLibraryPorts(db) per process, under
 * LibraryPortsToken, then each port under its core token):
 *
 *   const ports = createLibraryPorts(db);
 *   container
 *     .value(AuditLogStoreToken, ports.auditLog)
 *     .value(EventLogStoreToken, ports.eventLog)
 *     .value(ConversationStoreToken, ports.conversations)
 *     .value(SettingsStoreToken, ports.settings);
 *
 * `ports.artifacts` is the agent's ArtifactStore (files under `<db folder>/artifacts`
 * unless `options.artifacts.dir` says otherwise); call its prune() once at start-up.
 */
import type {
  AcknowledgementStore,
  AuditLogStore,
  CloudCallSink,
  ConversationStore,
  EventLogStore,
  JobStore,
  TraceStore,
} from '@taalcut/core';
import {
  createArtifactStore,
  type ArtifactStoreOptions,
  type LibraryArtifactStore,
} from '../artifacts/store';
import type { LibraryDatabase } from '../db/database';
import { createConversationStore } from './conversations';
import { createJobStore } from './job-store';
import { createTraceStore, createUsageStore, type LibraryUsageStore } from './observability';
import { createAcknowledgementStore, createSettingsStore, type LibrarySettingsStore } from './preferences';
import {
  createCloudCallSink,
  createEventLogStore,
  createModelProfileStore,
  type LibraryModelProfileStore,
} from './stores';
import { createCommandUnitOfWork, type CommandUnitOfWork } from './unit-of-work';

export interface LibraryPorts {
  /** For the command bus: commits each command's staged writes with its audit row (`commands`). */
  readonly auditLog: AuditLogStore;
  /** Where command handlers stage their writes. */
  readonly commands: CommandUnitOfWork;
  readonly eventLog: EventLogStore;
  readonly jobStore: JobStore;
  readonly cloudCalls: CloudCallSink;
  /** Pass a command's context to `save` and the write commits with its audit row. */
  readonly modelProfiles: LibraryModelProfileStore;
  readonly acknowledgements: AcknowledgementStore;
  /** Pass a command's context to `set` / `reset` and the write commits with its audit row. */
  readonly settings: LibrarySettingsStore;
  /** The chat backend's conversations. */
  readonly conversations: ConversationStore;
  /** Settings → Usage over the cloud-call log. */
  readonly usage: LibraryUsageStore;
  /** Agent traces for the developer viewer. */
  readonly traces: TraceStore;
  /** Large tool outputs by reference (core's ArtifactStore), with prune() and usage(). */
  readonly artifacts: LibraryArtifactStore;
}

export interface LibraryPortsOptions {
  readonly artifacts?: ArtifactStoreOptions;
}

/** Every port over one connection. Create it once per process: the unit of work holds staged writes. */
export function createLibraryPorts(db: LibraryDatabase, options: LibraryPortsOptions = {}): LibraryPorts {
  const commands = createCommandUnitOfWork(db);
  return {
    auditLog: commands.auditLog,
    commands,
    eventLog: createEventLogStore(db),
    jobStore: createJobStore(db),
    cloudCalls: createCloudCallSink(db),
    modelProfiles: createModelProfileStore(db, { commands }),
    acknowledgements: createAcknowledgementStore(db),
    settings: createSettingsStore(db, { commands }),
    conversations: createConversationStore(db),
    usage: createUsageStore(db),
    traces: createTraceStore(db),
    artifacts: createArtifactStore(db, options.artifacts),
  };
}

export {
  createArtifactStore,
  type ArtifactStoreOptions,
  type LibraryArtifactStore,
} from '../artifacts/store';

export * from './conversations';
export { createJobStore, toJobRecord } from './job-store';
export * from './observability';
export * from './preferences';
export {
  createAuditLogStore,
  createCloudCallSink,
  createEventLogStore,
  createModelProfileStore,
  type LibraryModelProfileStore,
} from './stores';
export { writeWith, type CommandStager } from './staging';
export * from './unit-of-work';
