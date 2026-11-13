// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readJson } from '../files';
import { parseApprovedHashes, type HashSample } from './hash';
import { parseRenderGolden, type RenderGolden } from './schema';

export interface LoadedGolden {
  golden: RenderGolden;
  timelinePath: string;
}

function parseFile(path: string): RenderGolden {
  return parseRenderGolden(readJson(path), path);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${path}: ${message}`, { cause: error });
  }
}

/** One timeline.json, a directory that contains one, or a directory of `<id>/timeline.json`. */
export function loadRenderGoldens(path: string): LoadedGolden[] {
  if (isFile(path)) return [{ golden: parseFile(path), timelinePath: path }];
  const direct = join(path, 'timeline.json');
  if (existsSync(direct)) return [{ golden: parseFile(direct), timelinePath: direct }];
  let names: string[];
  try {
    names = readdirSync(path).sort();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${path}: ${message}`, { cause: error });
  }
  const loaded: LoadedGolden[] = [];
  for (const name of names) {
    const timelinePath = join(path, name, 'timeline.json');
    if (!existsSync(timelinePath)) continue;
    const golden = parseFile(timelinePath);
    if (golden.id !== name) {
      throw new Error(`${timelinePath} id ${golden.id} does not match directory ${name}`);
    }
    loaded.push({ golden, timelinePath });
  }
  if (loaded.length === 0) throw new Error(`No render goldens (timeline.json) in ${path}`);
  return loaded;
}

/** Approved hashes live beside the timeline. Absent is a skip, not an error. */
export function loadApprovedHashes(timelinePath: string): HashSample[] | undefined {
  const path = join(dirname(timelinePath), 'hashes.json');
  if (!existsSync(path)) return undefined;
  return parseApprovedHashes(readJson(path), path).frames;
}
