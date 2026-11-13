// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Which folders may become sources: realpath, traversal and symlink cases. */
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { normaliseFolderPath, resolveFolder } from '../../src/index';
import { tempDir } from '../helpers';

/** A home with a Trip folder, a file, and Taalcut's data folder. */
function disk() {
  const root = realpathSync(tempDir());
  const home = join(root, 'home');
  const trip = join(home, 'Desktop', 'Trip');
  const data = join(home, 'Library', 'Application Support', 'Taalcut');
  mkdirSync(trip, { recursive: true });
  mkdirSync(join(data, 'library'), { recursive: true });
  writeFileSync(join(trip, 'a.mov'), 'x');
  return { root, home, trip, data, policy: { protectedRoots: [data], home } };
}

describe('normaliseFolderPath', () => {
  it('expands ~, removes dots and trailing slashes, and composes Unicode', () => {
    expect(normaliseFolderPath('~/Desktop/Trip/', '/Users/me')).toBe('/Users/me/Desktop/Trip');
    expect(normaliseFolderPath('~', '/Users/me')).toBe('/Users/me');
    expect(normaliseFolderPath(' /a//b/./c/../d ', undefined)).toBe('/a/b/d');
    expect(normaliseFolderPath('/Café'.normalize('NFD'))).toBe('/Café'.normalize('NFC'));
    expect(normaliseFolderPath('/')).toBe('/');
  });

  it('refuses relative paths, and ~ with no home', () => {
    expect(normaliseFolderPath('Desktop/Trip', '/Users/me')).toBeUndefined();
    expect(normaliseFolderPath('~/Trip')).toBeUndefined();
    expect(normaliseFolderPath('~me/Trip', '/Users/me')).toBeUndefined();
  });
});

describe('resolveFolder', () => {
  it('returns the real folder, through ~ and symlinks', async () => {
    const d = disk();
    expect(unwrap(await resolveFolder('~/Desktop/Trip/', d.policy))).toBe(d.trip);
    const link = join(d.root, 'shortcut');
    symlinkSync(d.trip, link);
    expect(unwrap(await resolveFolder(link, d.policy))).toBe(d.trip);
  });

  it.each([
    ['a missing folder', (d: ReturnType<typeof disk>) => join(d.home, 'Nope'), 'library.folder_missing', 'Nope'],
    ['a file', (d: ReturnType<typeof disk>) => join(d.trip, 'a.mov'), 'library.not_a_folder', 'a.mov'],
    ['a relative path', () => 'Desktop/Trip', 'library.folder_not_allowed', 'Trip'],
    ['the whole disk', () => '/', 'library.folder_not_allowed', '/'],
    ["Taalcut's data folder", (d: ReturnType<typeof disk>) => d.data, 'library.folder_not_allowed', 'Taalcut'],
    [
      'a folder inside it',
      (d: ReturnType<typeof disk>) => join(d.data, 'library'),
      'library.folder_not_allowed',
      'library',
    ],
    [
      'a path that climbs into it with ..',
      (d: ReturnType<typeof disk>) => join(d.trip, '..', '..', 'Library', 'Application Support', 'Taalcut'),
      'library.folder_not_allowed',
      'Taalcut',
    ],
  ])('refuses %s, naming the folder by its own name', async (_case, path, code, name) => {
    const d = disk();
    const result = await resolveFolder(path(d), d.policy);
    expect(!result.ok && result.error.code).toBe(code);
    // The message names the folder ("The Nope folder isn't on this Mac any more"), never by its path.
    expect(!result.ok && result.error.params).toMatchObject({ name });
  });

  it("refuses a symlink that points into Taalcut's data, however it is reached", async () => {
    const d = disk();
    const link = join(d.trip, 'innocent');
    symlinkSync(join(d.data, 'library'), link);
    const direct = await resolveFolder(link, d.policy);
    expect(!direct.ok && direct.error).toMatchObject({ code: 'library.folder_not_allowed', detail: expect.stringContaining('own data') });
    const viaHome = await resolveFolder('~/Desktop/Trip/innocent/', d.policy);
    expect(!viaHome.ok && viaHome.error.code).toBe('library.folder_not_allowed');
  });

  it('checks protected roots that do not exist yet as written', async () => {
    const d = disk();
    const later = join(d.home, 'Later');
    const result = await resolveFolder(d.trip, { protectedRoots: [later, d.home] });
    expect(!result.ok && result.error.code).toBe('library.folder_not_allowed');
  });
});
