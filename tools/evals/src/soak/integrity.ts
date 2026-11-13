// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

export interface AssetHash {
  id: string;
  sha256: string;
}

/**
 * What the app's port (`SoakApp.integrity`, desktop side, not built yet) reports after a scenario: it runs SQLite
 * `integrity_check`, hashes every asset's file, checks the audit log, probes renders and lists scratch. `sqlite` is
 * `'ok'` or the text of a failed check. Each list entry is the item name (asset id, audit id, render id, or scratch
 * path). `assets` is every asset with the hash of its file now; the harness compares it with the hashes the app
 * returned at import, so a changed or lost file is caught here as well as by the port.
 */
export interface IntegritySnapshot {
  sqlite: 'ok' | string;
  assetMismatches: string[];
  missingAudit: string[];
  invalidRenders: string[];
  orphanScratch: string[];
  assets: AssetHash[];
}

export function cleanIntegrity(assets: readonly AssetHash[] = []): IntegritySnapshot {
  return {
    sqlite: 'ok',
    assetMismatches: [],
    missingAudit: [],
    invalidRenders: [],
    orphanScratch: [],
    assets: [...assets],
  };
}

/** Every file imported during the run must still be an asset with the hash it had at import. */
export function importedFailures(imported: readonly AssetHash[], assets: readonly AssetHash[]): string[] {
  const now = new Map(assets.map((asset) => [asset.id, asset.sha256]));
  const failures: string[] = [];
  for (const asset of imported) {
    const hash = now.get(asset.id);
    if (hash === undefined) failures.push(`asset-missing:${asset.id}`);
    else if (hash !== asset.sha256) failures.push(`asset-changed:${asset.id}`);
  }
  return failures;
}

/**
 * Names every failed item. A clean snapshot returns an empty list.
 * The prefix is the check; the rest is the item the app reported.
 */
export function integrityFailures(snapshot: IntegritySnapshot): string[] {
  const failures: string[] = [];
  if (snapshot.sqlite !== 'ok') failures.push(`sqlite:${snapshot.sqlite}`);
  for (const item of snapshot.assetMismatches) failures.push(`asset-mismatch:${item}`);
  for (const item of snapshot.missingAudit) failures.push(`missing-audit:${item}`);
  for (const item of snapshot.invalidRenders) failures.push(`invalid-render:${item}`);
  for (const item of snapshot.orphanScratch) failures.push(`orphan-scratch:${item}`);
  return failures;
}
