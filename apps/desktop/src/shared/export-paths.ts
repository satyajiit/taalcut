// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where exports that aren't renders live (P3-V5 pro export: `.otio`, `.fcpxml`), agreed between the agent
 * process (core's ExportFileSink writes them) and main (`files.saveExportAs` copies one where the person
 * chooses). One flat folder: a window names a file, never a path. No Electron and no Node beyond path.
 */
import { join } from 'node:path';

/** `<userData>/exports`. */
export function exportsFolder(userData: string): string {
  return join(userData, 'exports');
}

/**
 * A file the sink wrote: no separators, not `.` or `..`, and not a hidden name (the sink's temporary files start
 * with a dot). Main checks a window's `fileName` with this before it reads anything.
 */
export function isExportFileName(fileName: string): boolean {
  return fileName.length > 0 && !/[/\\:\0]/.test(fileName) && !fileName.startsWith('.');
}

/** The written file's path, or null for a name the sink can't have written. */
export function exportFilePath(userData: string, fileName: string): string | null {
  return isExportFileName(fileName) ? join(exportsFolder(userData), fileName) : null;
}
