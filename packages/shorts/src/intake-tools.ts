// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  defineTool,
  IMPORT_COMMANDS,
  NO_TOOL_RETRY,
  PROJECT_COMMANDS,
  ulidSchema,
  type AsyncResult,
  type CommandToolContext,
} from '@taalcut/core';
import { z } from 'zod';
import { evidenceKey } from './evidence';

export const shortImportInputSchema = z
  .object({
    projectId: ulidSchema('Project'),
    path: z.string().max(4096).optional(),
    url: z.string().max(2048).optional(),
  })
  .refine((value) => Boolean(value.path) !== Boolean(value.url), 'Supply one source file or YouTube URL');
export const shortImportOutputSchema = z.object({
  assetId: ulidSchema('Asset'),
  sourceUrl: z.string().max(2048).optional(),
  sessionId: ulidSchema('ImportSession'),
});
export type ShortImportInput = z.output<typeof shortImportInputSchema>;
export type ShortImportOutput = z.output<typeof shortImportOutputSchema>;

export function createShortsImportTool(deps: {
  readonly localOnly?: boolean;
  readonly run: (input: ShortImportInput, context: CommandToolContext) => AsyncResult<ShortImportOutput>;
}) {
  return defineTool({
    name: 'shorts.importSource',
    version: '1.0.0',
    command: IMPORT_COMMANDS.createDraft,
    summary: 'Imports one local video or YouTube video and waits for source analysis.',
    description:
      'Import a creator-selected local video file or one HTTPS YouTube video into the managed ' +
      'library, preserving its source identity. Waits for transcription and visual analysis, then returns ' +
      'the assetId for shorts.generate. Never treats the source as a reference template. Source downloads ' +
      'are limited to four hours and 4 GiB. Does not publish to any account.',
    input: shortImportInputSchema,
    output: shortImportOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    timeoutMs: 6 * 60 * 60_000,
    retry: NO_TOOL_RETRY,
    permission: {
      filesystem: { read: ['user-selected', 'scratch', 'library'], write: ['library', 'scratch'] },
      network: deps.localOnly ? 'none' : 'internet',
    },
    idempotencyKey: (input) => evidenceKey('source-import', input),
    run: deps.run,
  });
}

export const shortProjectInputSchema = z.object({ name: z.string().trim().min(1).max(200) });
export const shortProjectOutputSchema = z.object({ projectId: ulidSchema('Project') });
export function createShortsProjectTool(deps: {
  readonly run: (
    input: z.output<typeof shortProjectInputSchema>,
    context: CommandToolContext,
  ) => AsyncResult<z.output<typeof shortProjectOutputSchema>>;
}) {
  return defineTool({
    name: 'shorts.createProject',
    version: '1.0.0',
    command: PROJECT_COMMANDS.create,
    summary: 'Opens a project for a new long-form-to-short request.',
    description:
      'Use first when a shorts request has no projectId. Creates a project with the normal budget ' +
      'and links this conversation, or reuses its existing project. Then import the source with shorts.importSource ' +
      'if needed and call shorts.generate with the returned projectId. Never invent an id or use a reference template.',
    input: shortProjectInputSchema,
    output: shortProjectOutputSchema,
    costClass: 'local',
    sideEffect: 'write',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['library'], write: ['library'] }, network: 'none' },
    idempotencyKey: (input) => evidenceKey('project', input),
    run: deps.run,
  });
}
