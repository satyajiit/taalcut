// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: a project's HyperFrames workspace, file by file. The workspace is content-addressed: a file is a path and
 * the sha256 of its bytes (a blob in `<userData>/workspaces/<projectId>/blobs/<2hex>/<sha256>`), and a revision is
 * the list of them. Paths are relative and plain: no absolute path, no `..`, no hidden or dot segment, no backslash,
 * so nothing a model writes can name a place outside its project's folder. The limits are the gate's (render SPEC
 * "HFW1") and the store's: every lane reads them from here.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { isId } from '../basics/id-schema';
import { sha256Schema } from '../templates/template-parts';

export const WORKSPACE_LIMITS = {
  /** Files in one composition, and changes in one `workspace.writeFiles`. */
  files: 32,
  /** Bytes in one file. */
  fileBytes: 64 * 1024,
  /** Bytes of all of a workspace's files at one revision. */
  workspaceBytes: 2 * 1024 * 1024,
  /** Files a workspace holds at one revision. */
  workspaceFiles: 512,
  /** A composition's variables. */
  variables: 16,
  /** Characters in a path. */
  pathLength: 160,
} as const;

/** One segment: starts with a letter, a digit or `_` (so never `.`, `..` or a hidden name), then `.`, `-`, `_`. */
const SEGMENT = '[A-Za-z0-9_][A-Za-z0-9._-]{0,63}';
const PATH_PATTERN = new RegExp(`^(?:${SEGMENT}/){0,7}${SEGMENT}$`);

/**
 * A path inside a workspace: `index.html`, `bubble/style.css`, `assets/<sha256>`. Relative, at most 8 segments of
 * ASCII letters, digits, `.`, `-` and `_`, none of them starting with a dot; never absolute, never `..`.
 */
export const workspacePathSchema = z
  .string()
  .max(WORKSPACE_LIMITS.pathLength)
  .regex(PATH_PATTERN, { message: 'A relative path of plain names, without .. or a leading /' });
export type WorkspacePath = z.output<typeof workspacePathSchema>;

/** A file at a revision: its path, the sha256 of its bytes and how many there are. */
export const workspaceFileSchema = z.object({
  path: workspacePathSchema,
  sha256: sha256Schema,
  bytes: z.int().min(0).max(WORKSPACE_LIMITS.fileBytes),
});
export type WorkspaceFile = z.output<typeof workspaceFileSchema>;

type Issues = z.RefinementCtx;

/** Each path once. */
export function checkUniquePaths(files: readonly { readonly path: string }[], ctx: Issues, at: string): void {
  const seen = new Set<string>();
  files.forEach((file, index) => {
    if (seen.has(file.path))
      ctx.addIssue({ code: 'custom', path: [at, index, 'path'], message: 'Repeated path' });
    seen.add(file.path);
  });
}

/** Their bytes together are at most `limit`. */
export function checkTotalBytes(
  files: readonly { readonly bytes: number }[],
  ctx: Issues,
  at: string,
  limit: number = WORKSPACE_LIMITS.workspaceBytes,
): void {
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (total > limit) ctx.addIssue({ code: 'custom', path: [at], message: `More than ${limit} bytes` });
}

/**
 * The text a composition's `hash` is the sha256 of: each file as `<path>\0<sha256>\n`, sorted by path (code
 * points). Equal files give equal hashes whatever order they were listed in.
 */
export function compositionHashInput(
  files: readonly { readonly path: string; readonly sha256: string }[],
): string {
  return [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => `${file.path}\0${file.sha256}\n`)
    .join('');
}

/** A composition's `hash`: sha256 (hex) over `compositionHashInput`, with WebCrypto (Node, Electron, a window). */
export async function compositionHash(
  files: readonly { readonly path: string; readonly sha256: string }[],
): Promise<string> {
  const data = new TextEncoder().encode(compositionHashInput(files));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Where a project's blob lives, relative to the app's user-data folder: `workspaces/<projectId>/blobs/<2hex>/<sha256>`
 * (library's content-assets pattern). The library writes it; render reads it to compile and draw a composition.
 */
export function workspaceBlobPath(projectId: string, sha256: string): string {
  // Both come from validated records; anything else would name a path outside the project's folder.
  if (!isId(projectId) || !sha256Schema.safeParse(sha256).success)
    throw new Error('Not a project id and sha256');
  return `workspaces/${projectId}/blobs/${sha256.slice(0, 2)}/${sha256}`;
}

/** HFW1-TPL: the templates' pool's folder name under `workspaces/` (not a ULID, so never a project's). */
export const TEMPLATE_BLOBS_SCOPE = 'templates';

/**
 * HFW1-TPL: where a template composition's file lives: `workspaces/templates/blobs/<2hex>/<sha256>`, one pool for
 * every template, apart from any project (a project's folder goes with the project, a template outlives it). A make
 * copies the files it draws with into its own project's workspace before its timeline's copies are drawn.
 */
export function templateBlobPath(sha256: string): string {
  if (!sha256Schema.safeParse(sha256).success) throw new Error('Not a sha256');
  return `workspaces/${TEMPLATE_BLOBS_SCOPE}/blobs/${sha256.slice(0, 2)}/${sha256}`;
}
