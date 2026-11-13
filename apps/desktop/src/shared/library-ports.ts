// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Library's implementations of core's storage ports, registered by their
 * tokens. Main and every utility process call this (never the preload). The
 * ports come from one createLibraryPorts(db) per process, made on first use.
 */
import {
  AcknowledgementStoreToken,
  AuditLogStoreToken,
  CloudCallSinkToken,
  ConversationStoreToken,
  EventLogStoreToken,
  JobStoreToken,
  ModelProfileStoreToken,
  SettingsStoreToken,
  TraceStoreToken,
  UsageStoreToken,
  type Container,
} from '@taalcut/core';
import { createLibraryPorts } from '@taalcut/library';
import { CommandUnitOfWorkToken, LibraryDatabaseToken, LibraryPortsToken } from './tokens';

export function registerLibraryPorts(container: Container): Container {
  container.factory(LibraryPortsToken, ({ db }) => createLibraryPorts(db), {
    deps: { db: LibraryDatabaseToken },
  });
  const port = { deps: { ports: LibraryPortsToken } };
  return container
    .factory(AuditLogStoreToken, ({ ports }) => ports.auditLog, port)
    .factory(CommandUnitOfWorkToken, ({ ports }) => ports.commands, port)
    .factory(EventLogStoreToken, ({ ports }) => ports.eventLog, port)
    .factory(JobStoreToken, ({ ports }) => ports.jobStore, port)
    .factory(CloudCallSinkToken, ({ ports }) => ports.cloudCalls, port)
    .factory(ModelProfileStoreToken, ({ ports }) => ports.modelProfiles, port)
    .factory(SettingsStoreToken, ({ ports }) => ports.settings, port)
    .factory(AcknowledgementStoreToken, ({ ports }) => ports.acknowledgements, port)
    .factory(ConversationStoreToken, ({ ports }) => ports.conversations, port)
    .factory(UsageStoreToken, ({ ports }) => ports.usage, port)
    .factory(TraceStoreToken, ({ ports }) => ports.traces, port);
}
