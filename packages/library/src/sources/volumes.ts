// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Volumes and iCloud placeholders (ADR 0001, "External drives" and "iCloud
 * placeholders"), behind ports so a Windows build is new implementations.
 *
 * On macOS a volume's identity is its APFS Volume UUID from `diskutil info` on
 * the volume's mount point (`/` is a sealed snapshot; user files live on the
 * Data volume, which `df` names); on Linux, its filesystem UUID
 * (linux-volumes.ts). A location is `offline` when its volume's UUID is not
 * among the mounted volumes; `missing` only when Taalcut looked on a mounted
 * volume and the path was gone. The app picks the probe for its OS (desktop's
 * platform services); createVolumeProbe is the same choice for code without one.
 */
import { execFile } from 'node:child_process';
import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { createLinuxVolumeProbe } from './linux-volumes';
import type { VolumeInfo, VolumeProbe } from './volume-probe';

export type { VolumeInfo, VolumeProbe } from './volume-probe';

const run = promisify(execFile);

/** What a placeholder check may ask the mac helper (P2-L6): the file's iCloud download status. */
export type PlaceholderStatus = (path: string) => Promise<'placeholder' | 'local' | 'unknown'>;

/** Below this a dataless file is indistinguishable from a tiny real one; ADR: only larger files are candidates. */
export const PLACEHOLDER_MIN_BYTES = 64 * 1024;

/**
 * A dataless iCloud file has no blocks on disk. Stat only: reading it could start a download. A
 * candidate is confirmed by the helper's status call when there is one; without it the candidate is
 * treated as a placeholder (never read), which is the safe side.
 */
export async function isPlaceholder(
  path: string,
  info: Pick<Stats, 'blocks' | 'size'>,
  status?: PlaceholderStatus,
): Promise<boolean> {
  if (info.blocks !== 0 || info.size < PLACEHOLDER_MIN_BYTES) return false;
  if (!status) return true;
  return (await status(path).catch(() => 'unknown' as const)) !== 'local';
}

/** The `<key>K</key><string>V</string>` values of a flat plist. */
function plistValue(plist: string, key: string): string | null {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist);
  return match?.[1] ?? null;
}

/** `df -P` rows: the device and its mount point (which may contain spaces). */
function dfRows(output: string): { device: string; mountPoint: string }[] {
  return output
    .split('\n')
    .slice(1)
    .map((line) => /^(\S+)\s+\d+\s+\d+\s+\d+\s+\d+%\s+(.+)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ device: m[1]!, mountPoint: m[2]! }));
}

/**
 * macOS: `df -P` finds the mount point (firmlinks such as /Users resolve to the Data volume), then
 * `diskutil info -plist` reads its Volume UUID and name. Results are cached per mount point for
 * `cacheMs`; mounting or ejecting changes the set of mount points, not what is cached for one.
 */
export function createMacVolumeProbe(options: { readonly cacheMs?: number } = {}): VolumeProbe {
  const cacheMs = options.cacheMs ?? 60_000;
  const byMountPoint = new Map<string, { at: number; info: Promise<VolumeInfo> }>();

  const describe = (mountPoint: string): Promise<VolumeInfo> => {
    const cached = byMountPoint.get(mountPoint);
    if (cached && Date.now() - cached.at < cacheMs) return cached.info;
    const info = run('diskutil', ['info', '-plist', mountPoint], { timeout: 10_000 })
      .then(({ stdout }) => ({
        uuid: plistValue(stdout, 'VolumeUUID'),
        name: plistValue(stdout, 'VolumeName') ?? (basename(mountPoint) || null),
        mountPoint,
      }))
      .catch(() => ({ uuid: null, name: basename(mountPoint) || null, mountPoint }));
    byMountPoint.set(mountPoint, { at: Date.now(), info });
    return info;
  };

  return {
    async identify(path) {
      try {
        const { stdout } = await run('df', ['-P', path], { timeout: 10_000 });
        const row = dfRows(stdout)[0];
        return row ? await describe(row.mountPoint) : null;
      } catch {
        return null;
      }
    },
    async mountedUuids() {
      try {
        const { stdout } = await run('df', ['-P'], { timeout: 10_000 });
        const local = dfRows(stdout).filter((row) => row.device.startsWith('/dev/'));
        const infos = await Promise.all(local.map((row) => describe(row.mountPoint)));
        return new Set(infos.flatMap((info) => (info.uuid ? [info.uuid] : [])));
      } catch {
        return new Set();
      }
    },
  };
}

/** Elsewhere (Windows until it has its own, and tests that don't care): the device number stands in for an identity. */
export function createDeviceVolumeProbe(): VolumeProbe {
  return {
    async identify(path) {
      const info = await stat(path).catch(() => undefined);
      return info ? { uuid: `dev:${info.dev}`, name: null, mountPoint: '/' } : null;
    },
    async mountedUuids() {
      const info = await stat('/').catch(() => undefined);
      return new Set(info ? [`dev:${info.dev}`] : []);
    },
  };
}

/** The probe for `platform` (this OS by default). */
export function createVolumeProbe(platform: NodeJS.Platform = process.platform): VolumeProbe {
  if (platform === 'darwin') return createMacVolumeProbe();
  if (platform === 'linux') return createLinuxVolumeProbe();
  return createDeviceVolumeProbe();
}
