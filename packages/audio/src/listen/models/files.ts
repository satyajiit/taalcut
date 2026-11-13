// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where each listening model's files are (EAR1-F3's components; tools/components/listen/README.md). The desktop asks
 * the component manager for the build that runs here (`variant: true`: fp16 on a Metal Mac, int8 elsewhere); tests
 * and the build tools point at a folder of unpacked builds. The installed id says the dtype.
 */
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { err, ok, type AsyncResult, type ComponentInstallerPort } from '@taalcut/core';
import type { ListenDtype } from '../config';
import { ListenModelMissing } from '../errors';

export type ListenModelName = 'clapAudio' | 'clapText' | 'ast';

/** The base component id of each model; `<id>-fp16` is its Metal variant. */
export const LISTEN_COMPONENTS: Readonly<Record<ListenModelName, string>> = {
  clapAudio: 'clap-general-audio',
  clapText: 'clap-general-text',
  ast: 'ast-audioset',
};

export interface ResolvedListenModel {
  readonly name: ListenModelName;
  /** The installed build's id, e.g. `clap-general-audio-fp16`. */
  readonly componentId: string;
  readonly dir: string;
  readonly modelPath: string;
  readonly dtype: ListenDtype;
}

export interface ListenModelFiles {
  /** The build that runs here, installed on demand; `audio.listen_model_missing` naming the component otherwise. */
  resolve(name: ListenModelName, signal?: AbortSignal): AsyncResult<ResolvedListenModel>;
  /** The build already installed, without installing anything. */
  installed?(name: ListenModelName): Promise<ResolvedListenModel | undefined>;
}

export const dtypeOfComponent = (id: string): ListenDtype => (id.endsWith('-fp16') ? 'fp16' : 'int8');

function resolved(name: ListenModelName, componentId: string, dir: string): ResolvedListenModel {
  return { name, componentId, dir, modelPath: join(dir, 'model.onnx'), dtype: dtypeOfComponent(componentId) };
}

export interface InstalledListenFilesOptions {
  /**
   * EAR1-R1: the member of a model's variant group this machine runs, installing nothing (the desktop's
   * ComponentVariantToken: fp16 on a Metal Mac, int8 under TAALCUT_FORCE_CPU). With it `installed` reports only that
   * build: the other dtype on disk is not this machine's, and running it would key, and score, as the wrong one.
   */
  readonly variantOf?: (id: string) => AsyncResult<string>;
}

/** Through core's component installer (the desktop's roots). */
export function installedListenFiles(
  components: ComponentInstallerPort,
  options: InstalledListenFilesOptions = {},
): ListenModelFiles {
  return {
    async resolve(name, signal) {
      const id = LISTEN_COMPONENTS[name];
      const installed = await components.install(id, { variant: true, ...(signal ? { signal } : {}) });
      if (!installed.ok) {
        return err(
          ListenModelMissing({ component: id }, { detail: installed.error.detail ?? installed.error.code }),
        );
      }
      return ok(resolved(name, installed.value.id, installed.value.path));
    },
    async installed(name) {
      const id = LISTEN_COMPONENTS[name];
      if (options.variantOf) {
        const chosen = await options.variantOf(id);
        const found = chosen.ok ? await components.get(chosen.value) : undefined;
        return found ? resolved(name, found.id, found.path) : undefined;
      }
      const found = (await components.get(`${id}-fp16`)) ?? (await components.get(id));
      return found ? resolved(name, found.id, found.path) : undefined;
    },
  };
}

/** Unpacked builds under `root/<component id>/` (pack-listen-models.mjs's `models/`), the dtype chosen. */
export function directoryListenFiles(root: string, dtype: ListenDtype): ListenModelFiles {
  const pick = async (name: ListenModelName): Promise<ResolvedListenModel | undefined> => {
    const id = LISTEN_COMPONENTS[name] + (dtype === 'fp16' ? '-fp16' : '');
    const dir = join(root, id);
    try {
      await access(join(dir, 'model.onnx'));
      return resolved(name, id, dir);
    } catch {
      return undefined;
    }
  };
  return {
    async resolve(name) {
      const found = await pick(name);
      return found ? ok(found) : err(ListenModelMissing({ component: LISTEN_COMPONENTS[name] }));
    },
    installed: pick,
  };
}
