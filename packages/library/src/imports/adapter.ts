// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { z } from 'zod';
import type {
  AsyncResult,
  CaptureGroup,
  ImportCapabilities,
  ImportDraft,
  ImportItem,
  ImportItemOutcome,
  ImportPreflight,
  ImportProgress,
  ImportSession,
  SourceId,
} from '@taalcut/core';
import type { IMPORT_COMMANDS, importCommandPayloads } from '@taalcut/core';

export type ImportCreateInput = z.output<(typeof importCommandPayloads)[typeof IMPORT_COMMANDS.createDraft]>;
export type ImportUpdateInput = z.output<(typeof importCommandPayloads)[typeof IMPORT_COMMANDS.updateDraft]>;
export interface PreparedImportItem {
  readonly item: ImportItem;
  readonly locator: unknown;
}
export interface PreparedImport {
  readonly sourceLabel: string;
  readonly destinationLabel: string;
  readonly sourceId?: SourceId;
  readonly items: readonly PreparedImportItem[];
  readonly captures?: readonly CaptureGroup[];
  readonly privateData?: unknown;
  readonly selectAll?: boolean;
}
export interface ImportRunContext {
  readonly session: ImportSession;
  readonly draft: ImportDraft;
  /** Retry contains only unfinished items. Locators remain private to the adapter. */
  readonly items: readonly PreparedImportItem[];
  readonly privateData: unknown;
  readonly signal: AbortSignal;
  /** Persist the transport run identity before following it, so relaunch resumes that exact run. */
  checkpoint(privateData: unknown): void;
  report(outcome: ImportItemOutcome): void;
  source?(sourceId: SourceId): void;
  progress(patch: Partial<ImportProgress>): void;
}
export interface ImportAdapter {
  /** Release adapter-owned connection observers on application shutdown. */
  close?(): Promise<void> | void;
  readonly capabilities: ImportCapabilities;
  /** Other source readers can delay disconnect after this session finishes. */
  safeToDisconnect?(draft: ImportDraft, privateData: unknown): boolean;
  /** Scope filters (for example recursive folders) apply identically to preflight and execution. */
  includes?(draft: ImportDraft, item: PreparedImportItem, privateData: unknown): boolean;
  prepare(input: ImportCreateInput): AsyncResult<PreparedImport>;
  /** Revalidate source identity, required members and free space immediately before starting. */
  preflight?(
    draft: ImportDraft,
    items: readonly PreparedImportItem[],
    privateData: unknown,
    /** Only explicit Start/Resume may reconnect a device; review and restored routes are read-only. */
    options?: { readonly starting: boolean },
  ): AsyncResult<Partial<ImportPreflight>>;
  /** Must settle only after all reads/writes have quiesced, including cancellation. */
  run(context: ImportRunContext): AsyncResult<void>;
}
