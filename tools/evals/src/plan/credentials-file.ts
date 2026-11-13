// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The evals' own sign-in store (HFW1 dsn): `~/.taalcut-eval/credentials.json`, a SecretStore that @taalcut/models'
 * auth broker keeps its ChatGPT sign-in in (the credential, its index, the eval's device id). It is never the app's
 * vault or Keychain, which the evals don't read. As with the Codex CLI's auth.json: the file is mode 0600 in a
 * folder of its own (0700) that holds nothing else, and `eval:signout` deletes it. Writes are one at a time, each
 * the whole file.
 */
import { access, chmod, mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { err, ok, UnknownError, type AsyncResult } from '@taalcut/core';
import type { SecretStore } from '@taalcut/models';

export const EVAL_CREDENTIALS_FOLDER = '.taalcut-eval';
export const EVAL_CREDENTIALS_FILE = 'credentials.json';

/** Where the eval keeps its sign-in, under `home` (default: the user's home). */
export function evalCredentialsPath(home: string = homedir()): { readonly folder: string; readonly file: string } {
  const folder = join(home, EVAL_CREDENTIALS_FOLDER);
  return { folder, file: join(folder, EVAL_CREDENTIALS_FILE) };
}

const failed = (detail: string) => err(UnknownError(undefined, { detail }));

/** The SecretStore over the file. Nothing is written until the first `set`. */
export function evalCredentialsStore(home?: string): SecretStore {
  const { folder, file } = evalCredentialsPath(home);
  let turn: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(task: () => Promise<T>): Promise<T> => {
    const next = turn.then(task, task);
    turn = next.catch(() => undefined);
    return next;
  };

  async function load(): Promise<Record<string, string>> {
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw cause;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  }

  async function save(values: Record<string, string>): Promise<void> {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await chmod(folder, 0o700);
    await writeFile(file, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
    // writeFile's mode applies only when it creates the file.
    await chmod(file, 0o600);
  }

  return {
    get: (key): AsyncResult<string | undefined> =>
      inTurn(async () => {
        try {
          return ok((await load())[key]);
        } catch {
          return failed(`${file} could not be read`);
        }
      }),
    set: (key, value): AsyncResult<void> =>
      inTurn(async () => {
        try {
          await save({ ...(await load()), [key]: value });
          return ok(undefined);
        } catch {
          return failed(`${file} could not be written`);
        }
      }),
    delete: (key): AsyncResult<void> =>
      inTurn(async () => {
        try {
          const values = await load();
          if (!(key in values)) return ok(undefined);
          delete values[key];
          await save(values);
          return ok(undefined);
        } catch {
          return failed(`${file} could not be written`);
        }
      }),
  };
}

/** Deletes the eval's sign-in: the file, then its folder when nothing else is in it. */
export async function deleteEvalCredentials(home?: string): Promise<boolean> {
  const { folder, file } = evalCredentialsPath(home);
  const existed = await access(file).then(
    () => true,
    () => false,
  );
  await rm(file, { force: true });
  await rmdir(folder).catch(() => undefined);
  return existed;
}
