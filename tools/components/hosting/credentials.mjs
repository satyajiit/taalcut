// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The R2 upload credentials, read from the owner's env file outside the repository
 * (~/.config/taalcut/r2-components.env, or TAALCUT_R2_ENV). The file must be readable by its owner only. The
 * secret never leaves this object: it isn't enumerable, so logging or serialising the config doesn't show it, and
 * errors name missing fields, never values.
 */
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_ENV_FILE = join(homedir(), '.config', 'taalcut', 'r2-components.env');

const FIELDS = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_PUBLIC_BASE', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

/** KEY=VALUE lines; blank lines, # comments and an `export ` prefix are allowed; one layer of quotes is removed. */
export function parseEnv(text) {
  const values = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0])
      value = value.slice(1, -1);
    values.set(line.slice(0, eq).trim(), value);
  }
  return values;
}

/** The config from parsed values; throws naming the empty fields. */
export function configFrom(values) {
  const empty = FIELDS.filter((field) => !values.get(field));
  if (empty.length > 0) throw new Error(`empty in the R2 env file: ${empty.join(', ')}`);
  const config = {
    accountId: values.get('R2_ACCOUNT_ID'),
    bucket: values.get('R2_BUCKET'),
    publicBase: values.get('R2_PUBLIC_BASE'),
    accessKeyId: values.get('R2_ACCESS_KEY_ID'),
  };
  Object.defineProperty(config, 'secretAccessKey', {
    value: values.get('R2_SECRET_ACCESS_KEY'),
    enumerable: false,
  });
  return config;
}

export async function loadR2Config(path = process.env.TAALCUT_R2_ENV || DEFAULT_ENV_FILE) {
  const { mode } = await stat(path);
  if ((mode & 0o077) !== 0) throw new Error(`${path} is readable by others: chmod 600 it`);
  return configFrom(parseEnv(await readFile(path, 'utf8')));
}
