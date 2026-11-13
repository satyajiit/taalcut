// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Copying and removing whole .app bundles for the rollback clone. Always through /bin/cp and /bin/rm: Electron's
 * fs treats a bundle's app.asar as a folder, so fs.cp and fs.rm fail on it (verify-download.ts says the same).
 * `cp -c` asks APFS for a clone (copy-on-write, instant, no extra disk); on a volume without clones it is a
 * plain copy.
 */
import type { Exec } from './verify-download';

export interface BundleOps {
  /** Replaces `to` with a clone of `from`. */
  clone(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export function createBundleOps(exec: Exec): BundleOps {
  return {
    async clone(from, to) {
      await exec('/bin/rm', ['-rf', to]);
      await exec('/bin/mkdir', ['-p', parentOf(to)]);
      try {
        await exec('/bin/cp', ['-cR', from, to]);
      } catch {
        // No clonefile on this volume: a full copy (ditto keeps the code signature's extended attributes).
        await exec('/bin/rm', ['-rf', to]);
        await exec('/usr/bin/ditto', [from, to]);
      }
    },
    async remove(path) {
      await exec('/bin/rm', ['-rf', path]);
    },
  };
}

function parentOf(path: string): string {
  const slash = path.replace(/\/+$/, '').lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : '/';
}
