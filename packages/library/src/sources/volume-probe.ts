// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The volume probe port (volumes.ts): what each OS's probe answers (macOS's there, Linux's in linux-volumes.ts). */
export interface VolumeInfo {
  /** APFS Volume UUID, a Linux filesystem UUID or a network share's `<type>:<source>`; null when the system can't say. */
  readonly uuid: string | null;
  /** Display only: renaming a volume doesn't change its identity. */
  readonly name: string | null;
  readonly mountPoint: string;
}

export interface VolumeProbe {
  /** The volume holding `path` (which must exist), or null if it can't be identified. */
  identify(path: string): Promise<VolumeInfo | null>;
  /** The UUIDs of the volumes mounted now. */
  mountedUuids(): Promise<ReadonlySet<string>>;
}
