// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which model builds an analysis runs on (EAR1-F7, EAR1-R1), looked up before the cache and before anything opens.
 *
 * - **What the key names.** Each build as its component id (the dtype) and its install folder (the version): a
 *   component update is a new key, as the title cache's is (search/title-cache.ts). A critique also names the AST
 *   build its music share runs on, or `no-ast`: a partial critique made before AST was installed is not served once
 *   it is.
 * - **`install: false`** looks builds up on the models' installed-only sessions (models/sessions.ts
 *   `installedOnly`): nothing is downloaded, at planning or at run time, and only the build this machine runs counts
 *   (models/files.ts `installed`).
 * - **Transient skips.** With `optionalModels`, a model that can't be had is skipped. When that is because an install
 *   failed (offline) or the runtime didn't load, rather than "not installed and not to be installed", the analysis is
 *   not cached: the next one tries again.
 */
import { basename } from 'node:path';
import { err, ok, type AsyncResult, type ListenModel, type TaalcutError } from '@taalcut/core';
import { LISTEN_CONFIG } from '../config';
import type { ListenModels } from '../describe/context';
import { ListenModelMissing, ListenUnavailable } from '../errors';
import {
  LISTEN_COMPONENTS,
  type ListenModelFiles,
  type ListenModelName,
  type ResolvedListenModel,
} from '../models/files';
import type { ListenSessions } from '../models/sessions';
import { wantsAst, wantsClap, type ListenOptions } from './schema';

/** The checkpoints a listening's `model` names (tools/components/manifest.listen.provisional.json). */
export const LISTEN_CHECKPOINTS = {
  clap: 'laion/larger_clap_general@16c8cc31',
  ast: 'MIT/ast-finetuned-audioset-10-10-0.4593@f826b80d',
} as const;

/** The models on one set of sessions, over the builds `files` finds. */
export interface ListenModelSet {
  readonly models: ListenModels;
  readonly sessions: ListenSessions;
  readonly files: ListenModelFiles;
  /** The same models on sessions that never install (`install: false`); absent: `files.installed` at planning. */
  readonly installedOnly?: ListenModelSet;
}

export interface ModelPlan {
  readonly set: ListenModelSet | null;
  readonly model: ListenModel | null;
  /** The builds in the cache key. */
  readonly id: string;
  /** The models the run may load: what was planned, and AST for the critique when its build is here. */
  readonly available: ReadonlySet<ListenModelName>;
  /** A model was skipped for a reason that may pass (a failed install, no runtime): the result isn't cached. */
  readonly transient: boolean;
}

export const NO_MODELS: ModelPlan = {
  set: null,
  model: null,
  id: 'none',
  available: new Set(),
  transient: false,
};
const SKIPPABLE = new Set(['audio.listen_model_missing', 'audio.listen_unavailable']);

/** With `optionalModels`, a model that can't run here is skipped; any other failure fails the analysis. */
export const skippable = (options: ListenOptions, error: TaalcutError): boolean =>
  options.optionalModels === true && SKIPPABLE.has(error.code);

/** A model the request said not to install, and isn't: a lasting answer (the key changes once it is installed). */
const lasting = (options: ListenOptions, error: TaalcutError): boolean =>
  options.install === false && error.code === 'audio.listen_model_missing';

/** The build as the key names it: its id (the dtype) and its install folder (the version). */
export const buildIdOf = (build: Pick<ResolvedListenModel, 'componentId' | 'dir'>): string =>
  `${build.componentId}/${basename(build.dir)}`;

function lookup(
  loaded: ListenModelSet,
  options: ListenOptions,
  signal?: AbortSignal,
): (name: ListenModelName) => AsyncResult<ResolvedListenModel> {
  const { installedOnly } = loaded;
  if (options.install !== false) return (name) => loaded.sessions.model(name, signal);
  if (installedOnly) return (name) => installedOnly.sessions.model(name, signal);
  return async (name) => {
    const found = await loaded.files.installed?.(name);
    return found ? ok(found) : err(ListenModelMissing({ component: LISTEN_COMPONENTS[name] }));
  };
}

export async function planModels(
  models: (() => Promise<ListenModelSet>) | undefined,
  options: ListenOptions,
  signal?: AbortSignal,
): AsyncResult<ModelPlan> {
  if (!wantsClap(options.want)) return ok(NO_MODELS);
  const failed = (error: TaalcutError, transient = !lasting(options, error)) =>
    skippable(options, error) ? ok({ ...NO_MODELS, transient }) : err(error);
  if (!models) return failed(ListenUnavailable({ reason: 'no_models' }), false);
  const loaded = await models();
  const set = options.install === false ? (loaded.installedOnly ?? loaded) : loaded;
  const find = lookup(loaded, options, signal);
  const ast = wantsAst(options.want);
  const names: ListenModelName[] = ast ? ['clapAudio', 'ast'] : ['clapAudio'];
  const builds: string[] = [];
  const available = new Set<ListenModelName>(names);
  let dtype: ListenModel['dtype'] = 'int8';
  for (const name of names) {
    const found = await find(name);
    if (!found.ok) return failed(found.error);
    builds.push(buildIdOf(found.value));
    if (name === 'clapAudio') dtype = found.value.dtype;
  }
  let transient = false;
  if (options.critique && !ast) {
    // The critique's music share runs on AST when it can be had (installed, or installable when the request
    // allows): the key says which, so a partial critique isn't served once AST is here.
    const found = await find('ast');
    if (found.ok) {
      builds.push(`critique:${buildIdOf(found.value)}`);
      available.add('ast');
    } else if (found.error.code === 'core.cancelled') return found;
    else {
      builds.push('critique:no-ast');
      transient = !lasting(options, found.error);
    }
  }
  const model: ListenModel = {
    clap: LISTEN_CHECKPOINTS.clap,
    ast: ast ? LISTEN_CHECKPOINTS.ast : null,
    dtype,
    configVersion: LISTEN_CONFIG.version,
  };
  return ok({
    set,
    model,
    id: `${LISTEN_CHECKPOINTS.clap}|${ast ? LISTEN_CHECKPOINTS.ast : '-'}|${builds.join('|')}`,
    available,
    transient,
  });
}
