// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `workspace.importMedia` (AGT2 sbx): the one way media the workspace shell made reaches the library. The sandbox
 * never writes outside its folder; this trusted command reads a file from the project's out/ (never following a
 * link, one link only, at most 500 MB), knows its type by its first bytes (MP4, QuickTime, PNG, JPEG, WebP, WAV,
 * MP3, FLAC, Ogg), and keeps it through core's GeneratedAssetSink: content-addressed under the originals root,
 * de-duplicated, recorded as generated (generation `workspace`) and indexed like an import, so render's AI
 * inventory and Content Credentials count it as made by a model. Undo trashes a new asset (`library.trashAssets`,
 * which restore takes back); bytes the library already had are that asset again, with nothing to undo.
 */
import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import {
  defineCommand,
  defineTool,
  err,
  idSchema,
  LIBRARY_COMMANDS,
  NO_TOOL_RETRY,
  NotFoundError,
  ok,
  ValidationError,
  type AnyCommand,
  type AsyncResult,
  type CommandOutcome,
  type GeneratedAssetSink,
  type GeneratedMediaType,
  type ProjectId,
} from '@taalcut/core';
import { z } from 'zod';
import { shellFolderOf, SHELL_DIRS } from './folder';
import { projectIdInput, readPlain, shellPath, SHELL_TOOLS_VERSION } from './tool-deps';

export const WORKSPACE_IMPORT_COMMAND = 'workspace.importMedia';
/** The generated sink's ceiling. */
export const MAX_IMPORT_BYTES = 500 * 1024 * 1024;

const EXTENSION: Readonly<Record<GeneratedMediaType, string>> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/** The media type by the file's first bytes; null for anything the library doesn't keep from a generator. */
export function mediaTypeOf(bytes: Uint8Array): GeneratedMediaType | null {
  const ascii = (from: number, to: number) => Buffer.from(bytes.subarray(from, to)).toString('latin1');
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'qt  ') return 'video/quicktime';
    // An audio-only MPEG-4 isn't a video the library would index as one.
    return brand.startsWith('M4A') || brand.startsWith('M4B') ? null : 'video/mp4';
  }
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii(0, 4) === 'fLaC') return 'audio/flac';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)) return 'audio/mpeg';
  return null;
}

export const workspaceImportPayloadSchema = z.object({
  projectId: idSchema<'Project'>(),
  /** A file in the project's out/, relative to its shell folder: 'out/final.mp4'. */
  path: z.string().min(1).max(512),
  /** The agent run that made it, for the provenance. */
  runId: idSchema<'AgentRun'>().nullable().default(null),
});

export const workspaceImportResultSchema = z.object({
  assetId: z.string(),
  /** The library had these bytes already: the same asset. */
  duplicate: z.boolean(),
  mediaType: z.string(),
  bytes: z.int(),
});
export type WorkspaceImportResult = z.output<typeof workspaceImportResultSchema>;

export interface ImportMediaDeps {
  /** `<userData>/shell`. */
  readonly root: string;
  readonly sink: GeneratedAssetSink;
  readonly clock?: () => number;
}

type Payload = z.output<typeof workspaceImportPayloadSchema>;

async function importFile(
  deps: ImportMediaDeps,
  payload: Payload,
): AsyncResult<CommandOutcome<WorkspaceImportResult>> {
  const top = payload.path.split('/')[0];
  if (top !== SHELL_DIRS.out)
    return err(ValidationError({ field: 'path' }, { detail: 'Only a file in out/ can be imported' }));
  const folder = await realpath(shellFolderOf(deps.root, payload.projectId)).catch(() => null);
  if (!folder)
    return err(NotFoundError({ entity: 'workspaceFolder' }, { detail: 'The workspace was never opened' }));
  const path = await shellPath(folder, payload.path);
  if (!path.ok) return path;
  const bytes = await readPlain(path.value, MAX_IMPORT_BYTES);
  if (!bytes.ok) return bytes;
  const mediaType = mediaTypeOf(bytes.value);
  if (!mediaType)
    return err(
      ValidationError(
        { field: 'path' },
        {
          detail: 'Not a video (MP4, QuickTime), image (PNG, JPEG, WebP) or audio (WAV, MP3, FLAC, Ogg) file',
        },
      ),
    );
  const sha256 = createHash('sha256').update(bytes.value).digest('hex');
  const kept = await deps.sink.put({
    bytes: bytes.value,
    mediaType,
    fileName: `workspace-${sha256.slice(0, 16)}.${EXTENSION[mediaType]}`,
    projectId: payload.projectId,
    provenance: {
      kind: 'generated',
      generation: 'workspace',
      provider: 'taalcut',
      model: 'workspace',
      access: 'local',
      quality: null,
      promptSha256: sha256,
      voiceId: null,
      providerRef: null,
      c2pa: 'unknown',
      costUsd: 0,
      runId: payload.runId,
      createdAt: (deps.clock ?? Date.now)(),
    },
  });
  if (!kept.ok) return kept;
  const result = {
    assetId: kept.value.assetId,
    duplicate: kept.value.duplicate,
    mediaType,
    bytes: bytes.value.byteLength,
  };
  return ok(
    kept.value.duplicate
      ? { result }
      : {
          result,
          inverse: { name: LIBRARY_COMMANDS.trashAssets, payload: { assetIds: [kept.value.assetId] } },
        },
  );
}

/** The command, for the agent process's bus (beside the library's, whose trashAssets is its inverse). */
export function workspaceImportCommand(deps: ImportMediaDeps): AnyCommand {
  return defineCommand({
    name: WORKSPACE_IMPORT_COMMAND,
    payload: workspaceImportPayloadSchema,
    sideEffect: 'write',
    handle: (payload) => importFile(deps, payload),
  }) as AnyCommand;
}

export const workspaceImportInputSchema = z.object({
  projectId: projectIdInput,
  path: z.string().min(1).max(512).describe("A file in out/: 'out/final.mp4'"),
});

export function workspaceImportTool() {
  return defineTool({
    name: 'workspace.importMedia',
    version: SHELL_TOOLS_VERSION,
    summary: 'Keeps a video, image or audio file the workspace made (in out/) in the library, undoably.',
    description:
      'Keeps a video (MP4, QuickTime), image (PNG, JPEG, WebP) or audio (WAV, MP3, FLAC, Ogg) file from the ' +
      "workspace's out/ in the library as a new asset, marked as made by the AI, and indexes it like any clip. " +
      'Then place it like any library asset. The same bytes again are the same asset. Undo takes it back.',
    tags: ['workspace', 'import', 'media', 'library', 'asset', 'keep', 'out'],
    input: workspaceImportInputSchema,
    output: workspaceImportResultSchema,
    costClass: 'local',
    sideEffect: 'write',
    command: WORKSPACE_IMPORT_COMMAND,
    timeoutMs: 120_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['scratch'], write: ['library'] }, network: 'none' },
    // The command keeps bytes by their hash, so a repeat is the same asset; each call reads the file as it is now.
    idempotencyKey: () => randomUUID(),
    summarize: (output) => `asset ${output.assetId}${output.duplicate ? ' (already in the library)' : ''}`,
    run: async (input, ctx) => {
      const done = await ctx.dispatch({
        projectId: input.projectId as ProjectId,
        path: input.path,
        runId: ctx.runId ?? null,
      });
      if (!done.ok) return done;
      const parsed = workspaceImportResultSchema.safeParse(done.value);
      return parsed.success
        ? ok(parsed.data)
        : err(ValidationError({ field: 'result' }, { detail: 'workspace.importMedia answered no asset' }));
    },
  });
}
