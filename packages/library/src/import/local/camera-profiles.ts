// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { basename, dirname, extname } from 'node:path';
import { mediaTypeOf } from '../../sources/media-files';

export interface CaptureFile {
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: number;
  readonly fileId: number;
  /** Evidence from embedded metadata; never guessed from the selected import method. */
  readonly evidence?: {
    readonly model?: string;
    readonly videoTracks?: number;
    readonly captureKey?: string;
    readonly processingMode?: string;
  };
}

export interface MediaCapturePlan {
  readonly key: string;
  readonly profile: 'generic' | 'dji' | 'insta360';
  readonly files: readonly CaptureFile[];
  readonly requiredNames: readonly string[];
  readonly optionalNames: readonly string[];
  readonly missingNames: readonly string[];
  readonly disposition: 'asset' | 'archive';
  readonly completeness: 'complete' | 'incomplete' | 'unknown';
  readonly warnings: readonly string[];
}

export interface CameraProfile {
  readonly id: MediaCapturePlan['profile'];
  matches(file: CaptureFile): boolean;
  key(file: CaptureFile): string;
  plan(files: readonly CaptureFile[]): MediaCapturePlan;
}

const raw = (name: string) => /\.(insv|insp)$/i.test(name);
const preview = (name: string) => /\.(lrv|lrf|thm)$/i.test(name);
const sidecar = (name: string) => /\.(srt|xml|xmp|json)$/i.test(name);
const instaName = /^(?:VID|LRV)_(\d{8}_\d{6})_(00|01|10)_(\d+)\.(insv|lrv)$/i;
const stem = (file: CaptureFile) => file.name.slice(0, -extname(file.name).length).toLowerCase();
const evidenceKey = (file: CaptureFile) => file.evidence?.captureKey;

function plan(
  profile: MediaCapturePlan['profile'],
  key: string,
  files: readonly CaptureFile[],
  requiredNames = files.filter((file) => !preview(file.name) && !sidecar(file.name)).map((file) => file.name),
  unknown = false,
): MediaCapturePlan {
  const names = new Set(files.map((file) => file.name.toLowerCase()));
  const missingNames = requiredNames.filter((name) => !names.has(name.toLowerCase()));
  const archived = files.some((file) => raw(file.name)) || !files.some((file) => mediaTypeOf(file.name));
  const mode = files.flatMap((file) => (file.evidence?.processingMode ? [file.evidence.processingMode] : []));
  return {
    key,
    profile,
    files,
    requiredNames,
    optionalNames: files.filter((file) => preview(file.name) || sidecar(file.name)).map((file) => file.name),
    missingNames,
    disposition: archived ? 'archive' : 'asset',
    completeness: missingNames.length ? 'incomplete' : unknown ? 'unknown' : 'complete',
    warnings: [
      ...(archived ? ['vendor-processing-required'] : []),
      ...(mode.some((value) => /freeframe|log|flat|unstabili[sz]ed/i.test(value))
        ? ['processing-unapplied']
        : []),
      ...(unknown ? ['capture-layout-unverified'] : []),
    ],
  };
}

const instaKey = (file: CaptureFile) => {
  const match = instaName.exec(file.name);
  return evidenceKey(file) ?? (match ? `${match[1]}_${match[3]}`.toLowerCase() : stem(file));
};

export const insta360Profile: CameraProfile = {
  id: 'insta360',
  matches: (file) => raw(file.name) || /insta360/i.test(file.evidence?.model ?? ''),
  key: instaKey,
  plan(files) {
    const originals = files.filter((file) => raw(file.name));
    const required = new Set(originals.map((file) => file.name));
    let unknown = false;
    for (const file of originals) {
      const match = instaName.exec(file.name);
      if (!match || !/\.insv$/i.test(file.name)) continue;
      const multitrack = (file.evidence?.videoTracks ?? 0) >= 2;
      const pairedModel = /(?:\bX[23]\b|ONE[ -]?(?:X2?|R|RS)\b)/i.test(file.evidence?.model ?? '');
      const pairedEvidence = files.some((candidate) => instaName.exec(candidate.name)?.[2] === '10');
      if (!multitrack && (pairedModel || pairedEvidence)) {
        required.add(file.name.replace(/_(00|10)_(\d+)\./i, '_00_$2.'));
        required.add(file.name.replace(/_(00|10)_(\d+)\./i, '_10_$2.'));
      } else if (!multitrack) {
        // X4/X5 can put both tracks in one file. A name alone does not prove the layout.
        unknown = true;
      }
    }
    return plan('insta360', instaKey(files[0]!), files, [...required], unknown);
  },
};

export const djiProfile: CameraProfile = {
  id: 'dji',
  matches: (file) => /^DJI_/i.test(file.name) || /dji|osmo/i.test(file.evidence?.model ?? ''),
  // Segments are related only with metadata evidence; consecutive filenames can be different takes.
  key: (file) => evidenceKey(file) ?? stem(file),
  plan: (files) => plan('dji', evidenceKey(files[0]!) ?? stem(files[0]!), files),
};

export const genericCameraProfile: CameraProfile = {
  id: 'generic',
  matches: () => true,
  key: (file) => evidenceKey(file) ?? stem(file),
  plan: (files) => plan('generic', evidenceKey(files[0]!) ?? stem(files[0]!), files),
};

/** No vendor decoder is invoked. Raw originals never enter an asset indexing queue. */
export function groupMediaCaptures(
  files: readonly CaptureFile[],
  profiles: readonly CameraProfile[] = [insta360Profile, djiProfile, genericCameraProfile],
): MediaCapturePlan[] {
  const groups = new Map<string, { profile: CameraProfile; files: CaptureFile[] }>();
  for (const file of files.filter((candidate) => !preview(candidate.name) && !sidecar(candidate.name))) {
    const profile = profiles.find((candidate) => candidate.matches(file)) ?? genericCameraProfile;
    const key = `${dirname(file.path)}\0${profile.id}\0${profile.key(file)}`;
    const group = groups.get(key) ?? { profile, files: [] };
    group.files.push(file);
    groups.set(key, group);
  }
  for (const file of files.filter((candidate) => preview(candidate.name) || sidecar(candidate.name))) {
    const group = [...groups.values()].find(
      ({ profile, files: members }) =>
        dirname(members[0]!.path) === dirname(file.path) && profile.key(members[0]!) === profile.key(file),
    );
    if (group) group.files.push(file);
  }
  return [...groups.values()].map(({ profile, files: members }) => ({
    ...profile.plan(members),
    key: `${dirname(members[0]!.path)}/${profile.key(members[0]!)}`,
  }));
}

export const isImportableFile = (path: string): boolean =>
  !!mediaTypeOf(path) || raw(path) || preview(path) || sidecar(path);
export const captureFileName = (path: string): string => basename(path).normalize('NFC');
