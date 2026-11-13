// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where things live inside the components folder (injected; the desktop app
 * passes `app.getPath('userData')/components`):
 *
 *   registry.json                          installed components (atomic writes)
 *   downloads/<id>@<version>-<sha12>.part  partial download, kept across restarts
 *   downloads/<id>@<version>-<sha12>.part.json   what the part was fetched from
 *   downloads/<id>@<version>-<sha12>.download    verified, not yet installed
 *   downloads/<id>@<version>-<notice sha12>.notice.part / .notice.download   its licence notice, the same way
 *   staging/<id>@<version>-<random>/       being extracted; swept at startup
 *   installed/<id>/<version>-<sha12>/      the installed files, and TAALCUT-NOTICE.txt (its licence notice)
 *
 * Everything is on one volume, so every move into place is a rename.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export interface ComponentLayout {
  readonly root: string;
  readonly registryPath: string;
  readonly downloadsDir: string;
  readonly stagingDir: string;
  readonly installedDir: string;
}

export function componentLayout(root: string): ComponentLayout {
  return {
    root,
    registryPath: join(root, 'registry.json'),
    downloadsDir: join(root, 'downloads'),
    stagingDir: join(root, 'staging'),
    installedDir: join(root, 'installed'),
  };
}

/** Identifies one artifact of one version. The sha prefix keeps a re-published version apart. */
export function artifactKey(id: string, version: string, sha256: string): string {
  return `${id}@${version}-${sha256.slice(0, 12)}`;
}

export function partPathFor(layout: ComponentLayout, id: string, version: string, sha256: string): string {
  return join(layout.downloadsDir, `${artifactKey(id, version, sha256)}.part`);
}

export function downloadPathFor(
  layout: ComponentLayout,
  id: string,
  version: string,
  sha256: string,
): string {
  return join(layout.downloadsDir, `${artifactKey(id, version, sha256)}.download`);
}

/**
 * The licence notice saved in every installed component's folder (UX2-DOWNLOADER round 3): the NOTICE.txt hosted
 * beside it, verified against `licence.notice`. A name of Taalcut's own, so it never meets a file of the component.
 */
export const NOTICE_FILE = 'TAALCUT-NOTICE.txt';

/** Where a component's licence notice downloads to, keyed by the notice's own sha256. */
export function noticePartPathFor(
  layout: ComponentLayout,
  id: string,
  version: string,
  noticeSha256: string,
): string {
  return join(layout.downloadsDir, `${artifactKey(id, version, noticeSha256)}.notice.part`);
}

export function noticeDownloadPathFor(
  layout: ComponentLayout,
  id: string,
  version: string,
  noticeSha256: string,
): string {
  return join(layout.downloadsDir, `${artifactKey(id, version, noticeSha256)}.notice.download`);
}

/** Relative to the root, with '/' separators, as stored in the registry. */
export function installDirFor(id: string, version: string, sha256: string): string {
  return `installed/${id}/${version}-${sha256.slice(0, 12)}`;
}

export function newStagingDir(layout: ComponentLayout, id: string, version: string): string {
  return join(layout.stagingDir, `${id}@${version}-${randomBytes(4).toString('hex')}`);
}

/** The component id a downloads/ or staging/ entry belongs to. */
export function idOfEntry(name: string): string {
  const at = name.indexOf('@');
  return at === -1 ? name : name.slice(0, at);
}
