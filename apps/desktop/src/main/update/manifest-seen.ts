// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The newest signature this Mac accepted per channel (SB-19): a channel file signed before it is a replay, for
 * example the file that offered a build the team since pulled. Kept in <userData>/updates/manifest-seen.json
 * (0600, atomic, parsed with zod). A damaged file counts as empty: refusing every update over it would strand the
 * person on this version, and only code running as them could have damaged it.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { MANIFEST_CHANNELS, type ManifestChannel } from './manifest-envelope';
import { readUpdateFile, writeUpdateFile } from './update-files';

const epochMs = z.int().nonnegative();
const seenSchema = z.strictObject({
  v: z.literal(1),
  channels: z.strictObject({
    latest: epochMs.optional(),
    beta: epochMs.optional(),
    alpha: epochMs.optional(),
    internal: epochMs.optional(),
  }),
});
type Seen = z.output<typeof seenSchema>['channels'];

export interface SeenSignatures {
  last(channel: ManifestChannel): number | undefined;
  /** Remembers `signedAt` when it is newer than what was kept. */
  accept(channel: ManifestChannel, signedAt: number): void;
}

export function manifestSeenFile(updatesDir: string): string {
  return join(updatesDir, 'manifest-seen.json');
}

export function seenSignatures(file: string, log: (line: string) => void = console.warn): SeenSignatures {
  const read = (): Seen => {
    const stored = readUpdateFile(file, seenSchema);
    if (!stored.ok) log(`[update] ${stored.error.code}: manifest-seen.json is read as empty`);
    return stored.ok && stored.value ? stored.value.channels : {};
  };
  return {
    last: (channel) => read()[channel],
    accept(channel, signedAt) {
      const channels = read();
      if ((channels[channel] ?? -1) >= signedAt) return;
      const next = Object.fromEntries(
        MANIFEST_CHANNELS.flatMap((name) => {
          const value = name === channel ? signedAt : channels[name];
          return value === undefined ? [] : [[name, value]];
        }),
      );
      const written = writeUpdateFile(file, { v: 1, channels: next });
      if (!written.ok) log(`[update] ${written.error.code}: manifest-seen.json not written`);
    },
  };
}
