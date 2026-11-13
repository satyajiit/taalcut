// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where the hardware session folder lives, and making sure it is this user's alone. Every process of the app (and
 * every Taalcut of this user: another channel, a development build) must name the same folder, and no other user
 * may: the slots are files any writer could forge or delete. macOS's temporary folder is already per user
 * (`$TMPDIR` under /var/folders). On Linux /tmp is shared by every user, so the folder goes under
 * `$XDG_RUNTIME_DIR` (per user, 0700, made by the login session), and without one under /tmp with the uid in its
 * name, made 0700 and refused if another user owns it.
 */
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const HARDWARE_SESSION_FOLDER = 'taalcut-hardware-sessions';

export interface SessionFolderHost {
  readonly platform?: NodeJS.Platform;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly tmpdir?: string;
  readonly uid?: number;
}

/** The folder for this user: per platform as the file comment says. Pure: nothing is created. */
export function hardwareSessionFolder(host: SessionFolderHost = {}): string {
  const platform = host.platform ?? process.platform;
  const temp = host.tmpdir ?? tmpdir();
  if (platform === 'darwin' || platform === 'win32') return join(temp, HARDWARE_SESSION_FOLDER);
  const runtime = (host.env ?? process.env)['XDG_RUNTIME_DIR'];
  if (runtime && isAbsolute(runtime)) return join(runtime, HARDWARE_SESSION_FOLDER);
  const uid = host.uid ?? process.getuid?.() ?? 0;
  return join(temp, `${HARDWARE_SESSION_FOLDER}-${uid}`);
}

/**
 * Makes `dir` (0700) and checks it is a real folder this user owns that nobody else can write; one that is ours
 * but open is closed to 0700. Throws otherwise: the gate then caps this process only, and says so.
 */
export async function ensurePrivateFolder(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory()) throw new Error(`${dir} is not a folder (a link?)`);
  const uid = process.getuid?.();
  if (uid === undefined) return; // Windows: no POSIX owner or mode bits to check.
  if (info.uid !== uid) throw new Error(`${dir} belongs to uid ${info.uid}, not ${uid}`);
  if ((info.mode & 0o077) !== 0) await chmod(dir, 0o700);
}
