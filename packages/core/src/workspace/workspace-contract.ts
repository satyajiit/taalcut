// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-UI: appContract.workspace, owner agent: the person's read-only look at a project's workspace (the editor's
 * files viewer). `list` gives its revisions, newest first, and which one is the head; `read` gives one file's text
 * by its sha256 (a revision's file, or a file of a composition a timeline holds a copy of). A file is what a model
 * wrote: untrusted, shown as text only, never run. Nothing here writes: the viewer's Restore is
 * `workspace.restore` through `commands.dispatch`, so ⌘Z takes it back like any edit.
 *
 * The agent serves it over the WorkspaceStore port (`workspaceFilesOver`), once the library registers the store.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { NotFoundError, ValidationError } from '../basics/errors';
import { err, ok, type AsyncResult } from '../basics/result';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import { sha256Schema } from '../templates/template-parts';
import { workspaceRevisionSchema, type WorkspaceRevision } from './composition';
import type { WorkspaceStore } from './workspace-commands';
import { WORKSPACE_LIMITS } from './workspace-files';

/** The most revisions one `list` gives (the newest). */
export const WORKSPACE_LIST_MAX = 50;

const projectId = idSchema<'Project'>();

export const workspaceListInputSchema = z.object({
  projectId,
  /** Default and most: WORKSPACE_LIST_MAX. */
  limit: z.int().min(1).max(WORKSPACE_LIST_MAX).optional(),
});
export type WorkspaceListInput = z.output<typeof workspaceListInputSchema>;

export const workspaceListingSchema = z.object({
  /** The head revision; 0 for a workspace nothing was written to. */
  head: z.int().min(0),
  /** Newest first. Revisions after the head are there when it was restored to an earlier one. */
  revisions: z.array(workspaceRevisionSchema).max(WORKSPACE_LIST_MAX),
});
export type WorkspaceListing = z.output<typeof workspaceListingSchema>;

export const workspaceReadInputSchema = z.object({ projectId, sha256: sha256Schema });
export type WorkspaceReadInput = z.output<typeof workspaceReadInputSchema>;

/** The largest picture `read` gives back as bytes (an option's still, an image under `assets/`). */
export const WORKSPACE_IMAGE_BYTES = WORKSPACE_LIMITS.fileBytes;

export const WORKSPACE_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;

export const workspaceFileTextSchema = z.object({
  sha256: sha256Schema,
  bytes: z.int().min(0).max(WORKSPACE_LIMITS.fileBytes),
  /** The file as UTF-8 text; null when its bytes aren't text (an image under `assets/`). Untrusted. */
  text: z.string().max(WORKSPACE_LIMITS.fileBytes).nullable(),
  /**
   * DSG2: the file as a picture, when its bytes are a JPEG or a PNG of at most WORKSPACE_IMAGE_BYTES (a still of a
   * design over the footage, for the options a person chooses between). Shown as an image only, never run.
   */
  image: z
    .object({
      mimeType: z.enum(WORKSPACE_IMAGE_TYPES),
      /** Base64 of at most WORKSPACE_IMAGE_BYTES. */
      dataBase64: z.string().max(Math.ceil(WORKSPACE_LIMITS.fileBytes / 3) * 4),
    })
    .optional(),
});
export type WorkspaceFileText = z.output<typeof workspaceFileTextSchema>;

export const workspaceContract = {
  /** The project's workspace revisions, newest first, and its head. */
  list: ipc.input(workspaceListInputSchema).output(workspaceListingSchema),
  /** One file's text, by its sha256. core.not_found (entity 'workspaceBlob') when the project has no such file. */
  read: ipc.input(workspaceReadInputSchema).output(workspaceFileTextSchema),
};

/** What the agent process serves appContract.workspace from. */
export interface WorkspaceFilesService {
  list(input: WorkspaceListInput): AsyncResult<WorkspaceListing>;
  read(input: WorkspaceReadInput): AsyncResult<WorkspaceFileText>;
}

export function workspaceRouter(service: WorkspaceFilesService) {
  const os = implementContract(workspaceContract);
  return os.router({
    list: os.list.handler(async ({ input }) => unwrapRpc(await service.list(input))),
    read: os.read.handler(async ({ input }) => unwrapRpc(await service.read(input))),
  });
}

const isNotFound = (code: string) => code === NotFoundError.code;

/** A JPEG's or a PNG's media type by its first bytes; null for anything else. */
export function workspaceImageType(data: Uint8Array): (typeof WORKSPACE_IMAGE_TYPES)[number] | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return png.every((byte, index) => data[index] === byte) ? 'image/png' : null;
}

/** The bytes as base64, without Node's Buffer (core runs in the renderer's tests too). */
function base64Of(data: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < data.length; at += 0x8000)
    binary += String.fromCharCode(...data.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** UTF-8 text, or null for bytes that aren't (invalid UTF-8, or a NUL, as in an image). */
export function workspaceText(data: Uint8Array): string | null {
  if (data.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

/**
 * The files viewer's reads over the workspace store: `list` asks the store for its revisions when it can list them
 * (`WorkspaceStore.revisions`), else reads them one by one from the newest down; `read` decodes a blob.
 */
export function workspaceFilesOver(store: WorkspaceStore): WorkspaceFilesService {
  const oneByOne = async (input: WorkspaceListInput, head: number): AsyncResult<WorkspaceRevision[]> => {
    const limit = input.limit ?? WORKSPACE_LIST_MAX;
    // Revisions after the head are kept when it was restored to an earlier one: find the newest.
    let newest = head;
    for (;;) {
      const next = await store.revision(input.projectId, newest + 1);
      if (!next.ok) {
        if (isNotFound(next.error.code)) break;
        return next;
      }
      newest += 1;
    }
    const revisions: WorkspaceRevision[] = [];
    for (let n = newest; n >= 1 && revisions.length < limit; n--) {
      const revision = await store.revision(input.projectId, n);
      if (!revision.ok) {
        if (isNotFound(revision.error.code)) continue;
        return revision;
      }
      revisions.push(revision.value);
    }
    return ok(revisions);
  };
  return {
    async list(input) {
      const head = await store.head(input.projectId);
      if (!head.ok) return head;
      const at = head.value?.revision ?? 0;
      const limit = input.limit ?? WORKSPACE_LIST_MAX;
      const revisions = store.revisions
        ? await store.revisions(input.projectId, limit)
        : await oneByOne(input, at);
      if (!revisions.ok) return revisions;
      return ok({
        head: at,
        revisions: [...revisions.value].sort((a, b) => b.revision - a.revision).slice(0, limit),
      });
    },
    async read(input) {
      const data = await store.readBlob(input.projectId, input.sha256);
      if (!data.ok) return data;
      if (data.value.byteLength > WORKSPACE_LIMITS.fileBytes)
        return err(
          ValidationError({ field: 'sha256' }, { detail: 'The file is larger than a workspace file can be' }),
        );
      const text = workspaceText(data.value);
      const mimeType =
        text === null && data.value.byteLength <= WORKSPACE_IMAGE_BYTES
          ? workspaceImageType(data.value)
          : null;
      return ok({
        sha256: input.sha256,
        bytes: data.value.byteLength,
        text,
        ...(mimeType ? { image: { mimeType, dataBase64: base64Of(data.value) } } : {}),
      });
    },
  };
}
