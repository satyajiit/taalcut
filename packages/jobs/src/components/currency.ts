// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How what is installed stands against the manifest, and what bringing it up to date still downloads. Since
 * sequence 16 a component can be current in its version and files while the manifest has replaced its licence
 * notice (a notice's key is its content, so the host can correct one without a new version; UX2-DOWNLOADER round 4):
 * that component needs only its notice, never its files again.
 */
import type { InstallPlan } from './manager-api';
import { leftToFetch, remainingNeed } from './install-one';
import { noticeDownloadPathFor, noticePartPathFor, type ComponentLayout } from './layout';
import type { ComponentArtifact, ComponentEntry, ComponentManifest } from './manifest';
import type { InstalledEntry } from './registry';
import { selectArtifact } from './selection';

/** Current; current but for its licence notice; or another version, or nothing usable. */
export type Currency = 'current' | 'notice' | 'outdated';

export interface Standing {
  /** What the registry has of it, when its files are still there. */
  readonly entry: InstalledEntry | undefined;
  readonly currency: Currency;
}

export function currencyOf(
  entry: InstalledEntry,
  component: ComponentEntry,
  artifact: ComponentArtifact,
): Currency {
  if (entry.version !== component.version || entry.sha256 !== artifact.sha256) return 'outdated';
  return entry.licence.notice.sha256 === component.licence.notice.sha256 ? 'current' : 'notice';
}

/** `outdated` when nothing usable is installed: no entry, its folder gone, or no artifact for this platform. */
export async function standingOf(
  entry: InstalledEntry | undefined,
  component: ComponentEntry,
  artifact: ComponentArtifact | undefined,
  present: (entry: InstalledEntry) => Promise<boolean>,
): Promise<Standing> {
  if (!artifact || !entry || !(await present(entry))) return { entry: undefined, currency: 'outdated' };
  return { entry, currency: currencyOf(entry, component, artifact) };
}

/** The components whose files are here and current but whose saved licence notice the manifest has replaced. */
export async function outdatedNotices(
  manifest: ComponentManifest,
  standing: (component: ComponentEntry) => Promise<Standing>,
): Promise<ComponentEntry[]> {
  const stale: ComponentEntry[] = [];
  for (const component of manifest.components)
    if ((await standing(component)).currency === 'notice') stale.push(component);
  return stale;
}

/** What `order` still needs, dependencies first: only a notice where that is all that is old. */
export async function planOf(
  order: readonly ComponentEntry[],
  options: {
    readonly layout: ComponentLayout;
    readonly platform: string;
    readonly headroomBytes: number;
    readonly standing: (component: ComponentEntry) => Promise<Standing>;
  },
): Promise<InstallPlan> {
  const components: InstallPlan['components'][number][] = [];
  for (const component of order) {
    const artifact = selectArtifact(component, options.platform);
    const { currency } = await options.standing(component);
    if (!artifact || currency === 'current') continue;
    const need =
      currency === 'notice'
        ? await noticeNeed(options.layout, component)
        : await remainingNeed(options.layout, component, artifact);
    components.push({ id: component.id, version: component.version, ...need });
  }
  const downloadBytes = components.reduce((sum, c) => sum + c.downloadBytes, 0);
  const extractBytes = components.reduce((sum, c) => sum + c.extractBytes, 0);
  return { components, downloadBytes, requiredBytes: downloadBytes + extractBytes + options.headroomBytes };
}

/** What a notice refresh downloads: the notice, less what of it is already on disk; nothing to unpack. */
async function noticeNeed(
  layout: ComponentLayout,
  component: ComponentEntry,
): Promise<{ downloadBytes: number; extractBytes: number }> {
  const { id, version } = component;
  const notice = component.licence.notice;
  const downloadBytes = await leftToFetch(
    noticePartPathFor(layout, id, version, notice.sha256),
    noticeDownloadPathFor(layout, id, version, notice.sha256),
    notice.size,
  );
  return { downloadBytes, extractBytes: 0 };
}
