// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1-WS: a project's workspace blobs over app://preview. A session's manifest may map a name it links
 * (`ws/card/style.css`) to a blob, `<userData>/workspaces/<projectId>/blobs/<2hex>/<sha256>`, and to nothing else
 * under that folder. The blob is served as every preview file is (GET and HEAD only, so read-only, with the
 * preview's CSP), typed by the name it was asked for, since a blob has no extension and nosniff keeps the browser
 * from guessing. Its real path must be exactly its name under the folder's real path: no link anywhere on the way.
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';

const BLOB = /^[0-9A-HJKMNP-TV-Z]{26}\/blobs\/([0-9a-f]{2})\/([0-9a-f]{64})$/;

/** `path` names a blob in one project's workspace under `root` (`<userData>/workspaces`). */
export function isWorkspaceBlobPath(root: string, path: string): boolean {
  const within = relative(resolve(root), path);
  if (within === '' || within.startsWith('..') || isAbsolute(within)) return false;
  const match = BLOB.exec(within.split(sep).join('/'));
  return match !== null && match[2]!.startsWith(match[1]!);
}
