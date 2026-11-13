// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** How the Linux probe reads the file system: never throws, so a missing file is an answer, not a failure. */
import { access, readdir, readFile } from 'node:fs/promises';

export interface LinuxFs {
  /** The file's text, or undefined when it is missing or unreadable. */
  readText(path: string): Promise<string | undefined>;
  /** The names in a directory; empty when it is missing. */
  list(path: string): Promise<readonly string[]>;
  exists(path: string): Promise<boolean>;
}

export const nodeLinuxFs: LinuxFs = {
  readText: (path) => readFile(path, 'utf8').catch(() => undefined),
  list: (path) => readdir(path).catch(() => []),
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
};
