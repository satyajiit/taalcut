// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { constants } from 'node:fs';
import { mkdir, open, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  err,
  newId,
  ok,
  toTaalcutError,
  ULID_PATTERN,
  ValidationError,
  type AsyncResult,
} from '@taalcut/core';

const root = (userData: string) => join(userData, 'creation-source-grants');

/** Called only by main after a native picker choice; the agent receives the opaque id. */
export async function grantCreationDirectory(userData: string, selected: string) {
  const path = await realpath(selected);
  const info = await stat(path);
  if (!info.isDirectory()) throw new Error('The selected source is not a directory');
  const accessId = newId<'CreationSourceGrant'>();
  await mkdir(root(userData), { recursive: true, mode: 0o700 });
  await writeFile(
    join(root(userData), `${accessId}.json`),
    JSON.stringify({ path, dev: info.dev, ino: info.ino }),
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  return { accessId, label: basename(path) };
}

export async function resolveCreationDirectory(userData: string, accessId: string): AsyncResult<string> {
  if (!ULID_PATTERN.test(accessId)) return err(ValidationError({ field: 'accessId' }));
  try {
    const file = await open(
      join(root(userData), `${accessId}.json`),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let grant: unknown;
    try {
      if ((await file.stat()).size > 16_384) return err(ValidationError({ field: 'accessId' }));
      grant = JSON.parse(await file.readFile('utf8'));
    } finally {
      await file.close();
    }
    if (
      !grant ||
      typeof grant !== 'object' ||
      !('path' in grant) ||
      typeof grant.path !== 'string' ||
      !('dev' in grant) ||
      !('ino' in grant)
    )
      return err(ValidationError({ field: 'accessId' }));
    const canonical = await realpath(grant.path);
    const info = await stat(canonical);
    if (canonical !== grant.path || !info.isDirectory() || info.dev !== grant.dev || info.ino !== grant.ino)
      return err(
        ValidationError({ field: 'accessId' }, { detail: 'The selected directory moved; select it again' }),
      );
    return ok(canonical);
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}
