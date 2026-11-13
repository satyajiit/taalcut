// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the workspace tools share (HFW1 "dsn"): the head revision and its files, a file's text, and a write. A write
 * puts each file's bytes in the store first, then dispatches `workspace.writeFiles` with paths and hashes over the
 * head it read, so undo and the audit log keep paths and hashes only. `_taalcut/` is Taalcut's: the model reads the
 * brief there and never writes in it.
 */
import { createHash } from 'node:crypto';
import {
  err,
  NotFoundError,
  ok,
  ValidationError,
  WORKSPACE_LIMITS,
  workspacePathSchema,
  type AsyncResult,
  type GraphicComposition,
  type ProjectId,
  type WorkspaceFile,
  type WorkspaceStore,
} from '@taalcut/core';
import type { GateFile } from '../gate/workspace-gate';

/** Taalcut's own folder in every workspace: the brief, never the model's to write. */
export const RESERVED_FOLDER = '_taalcut/';
/** The read-only brief trusted code writes for each job (brief.ts). */
export const BRIEF_PATH = '_taalcut/brief.md';

export interface Head {
  /** 0 for a workspace nothing was written to. */
  readonly revision: number;
  readonly files: readonly WorkspaceFile[];
}

export async function headOf(store: WorkspaceStore, projectId: ProjectId): AsyncResult<Head> {
  const head = await store.head(projectId);
  if (!head.ok) return head;
  return ok(
    head.value ? { revision: head.value.revision, files: head.value.files } : { revision: 0, files: [] },
  );
}

export const sha256Of = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');

const decoder = new TextDecoder('utf-8', { fatal: true });

/** A file's bytes as text: core.validation when they are not UTF-8 (an image is read by its path, not its text). */
export async function textOf(
  store: WorkspaceStore,
  projectId: ProjectId,
  file: Pick<WorkspaceFile, 'path' | 'sha256'>,
): AsyncResult<string> {
  const bytes = await store.readBlob(projectId, file.sha256);
  if (!bytes.ok) return bytes;
  try {
    return ok(decoder.decode(bytes.value));
  } catch {
    return err(ValidationError({ field: 'path' }, { detail: `${file.path} is not text` }));
  }
}

/** The head's file at `path`, or core.not_found naming it. */
export function fileAt(head: Head, path: string) {
  const file = head.files.find((entry) => entry.path === path);
  return file
    ? ok(file)
    : err(
        NotFoundError(
          { entity: 'workspaceFile', id: path },
          { detail: `No ${path} in the workspace: workspace.list shows its files.` },
        ),
      );
}

/** A path the model may write: a workspace path outside `_taalcut/`. */
export function writablePath(path: string) {
  if (!workspacePathSchema.safeParse(path).success)
    return err(
      ValidationError(
        { field: 'path' },
        {
          detail:
            'A relative path of plain names (letters, digits, ".", "-", "_"), without .. or a leading /',
        },
      ),
    );
  if ((path.split('/')[0] ?? '').toLowerCase() === '_taalcut')
    return err(
      ValidationError(
        { field: 'path' },
        { detail: `${RESERVED_FOLDER} is Taalcut's and read-only: write elsewhere` },
      ),
    );
  return ok(path);
}

const ASSET_PATH = /assets\/[0-9a-f]{64}(?![0-9a-f])/g;

/**
 * A composition's files as the gate reads them: the entry with its text, and every `assets/<sha256>` file the text
 * names that the head holds (one it doesn't hold is the gate's to refuse).
 */
export function compositionFiles(head: Head, entry: WorkspaceFile, text: string): GateFile[] {
  const named = new Set(text.match(ASSET_PATH) ?? []);
  const assets = head.files.filter((file) => file.path !== entry.path && named.has(file.path));
  return [{ path: entry.path, sha256: entry.sha256, bytes: entry.bytes, text }, ...assets];
}

/** A text change and its blob, before the dispatch. */
export interface StagedFile {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** Puts each text in the store, refusing one over a file's limit. */
export async function stageTexts(
  store: WorkspaceStore,
  projectId: ProjectId,
  texts: readonly { readonly path: string; readonly text: string }[],
): AsyncResult<StagedFile[]> {
  const staged: StagedFile[] = [];
  for (const { path, text } of texts) {
    const data = new TextEncoder().encode(text);
    if (data.byteLength > WORKSPACE_LIMITS.fileBytes)
      return err(
        ValidationError(
          { field: 'text' },
          { detail: `${path} would be ${data.byteLength} bytes; a file holds at most 64 KB` },
        ),
      );
    const put = await store.putBlob(projectId, data);
    if (!put.ok) return put;
    staged.push({ path, sha256: put.value.sha256, bytes: put.value.bytes });
  }
  return ok(staged);
}

/** `workspace.writeFiles` over the head the tool read; its answer is the new head. */
export async function writeStaged(
  dispatch: (payload: unknown) => AsyncResult<unknown>,
  projectId: ProjectId,
  baseRevision: number,
  staged: readonly StagedFile[],
): AsyncResult<number> {
  const done = await dispatch({
    projectId,
    baseRevision,
    files: staged.map((file) => ({ path: file.path, sha256: file.sha256 })),
  });
  if (!done.ok) return done;
  const revision = (done.value as { revision?: unknown } | null)?.revision;
  return typeof revision === 'number'
    ? ok(revision)
    : err(ValidationError({ field: 'revision' }, { detail: 'workspace.writeFiles answered no revision' }));
}

/** A composition's entry text from the store, for one a timeline holds a copy of. */
export async function copyText(
  store: WorkspaceStore,
  projectId: ProjectId,
  composition: GraphicComposition,
): AsyncResult<string> {
  const entry = composition.files.find((file) => file.path === composition.entry);
  if (!entry) return err(NotFoundError({ entity: 'workspaceFile', id: composition.entry }));
  return textOf(store, projectId, entry);
}

const MAX_READ_PAGE_JSON_BYTES = 7_600;

/** The text in pages of at most `size` characters, cut at a line end when one is near. */
export function pagesOf(text: string, size: number): string[] {
  const pages: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + size);
    while (
      end - at > 256 &&
      Buffer.byteLength(JSON.stringify(text.slice(at, end)), 'utf8') > MAX_READ_PAGE_JSON_BYTES
    ) {
      end = at + Math.floor((end - at) * 0.9);
    }
    if (end < text.length) {
      const line = text.lastIndexOf('\n', end);
      if (line > at + (end - at) / 2) end = line + 1;
    }
    pages.push(text.slice(at, end));
    at = end;
  }
  return pages.length > 0 ? pages : [''];
}
