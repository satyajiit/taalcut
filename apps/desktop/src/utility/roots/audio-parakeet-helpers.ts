// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Parakeet helpers of the jobs process (IX-A5): the mac helper's ASR service over a Core ML model folder,
 * one per folder, allowed to read the asset audio store's folder only. The helper is the packaged, pinned binary
 * in an app; in a checkout, `TAALCUT_MAC_HELPER` or `native/mac-helper/dist`. A missing helper is logged once
 * and leaves Parakeet's languages to whisper.
 */
import { createParakeetSidecar, type SpeechSidecar } from '@taalcut/audio';
import { createJsonLineSidecar, type JsonLineSidecar } from '@taalcut/media';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { macHelperResolver } from './mac-helper-resolver';

export interface ParakeetHelpers {
  /** The helper over this model folder, or undefined when the helper isn't there. */
  parakeet(modelsDir: string): Promise<SpeechSidecar | undefined>;
  close(): Promise<void>;
}

interface Helper {
  readonly sidecar: SpeechSidecar;
  readonly process: () => JsonLineSidecar | undefined;
}

function openHelper(config: UtilityConfig, command: string, modelsDir: string, storeRoot: string): Helper {
  let opened: JsonLineSidecar | undefined;
  const sidecar = createParakeetSidecar(
    { command, modelsDir, allowRoots: [storeRoot], env: config.packaged ? {} : process.env },
    (options) => (opened = createJsonLineSidecar(options)),
  );
  return { sidecar, process: () => opened };
}

export function createParakeetHelpers(
  config: UtilityConfig,
  storeRoot: string,
  log: (message: string) => void,
): ParakeetHelpers {
  const helpers = new Map<string, Helper>();
  const resolver = macHelperResolver(config);
  let warned = false;
  return {
    async parakeet(modelsDir) {
      const known = helpers.get(modelsDir);
      if (known) return known.sidecar;
      const found = await resolver.resolve();
      if (!found.ok) {
        if (!warned) log(`[audio] mac helper unavailable for Parakeet: ${found.error.code}`);
        warned = true;
        return undefined;
      }
      const helper = openHelper(config, found.value.path, modelsDir, storeRoot);
      helpers.set(modelsDir, helper);
      return helper.sidecar;
    },
    async close() {
      await Promise.all([...helpers.values()].map((helper) => helper.process()?.close()));
      helpers.clear();
    },
  };
}
