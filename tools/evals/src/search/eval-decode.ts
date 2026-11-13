// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The indexing harness's decode service (IX2-F14): what ships, from the same switch and the same default as the
 * app's jobs process (media's `openDecodeService`; `TAALCUT_DECODE_SERVICE` unset is `mac-helper` since IX3-R2, the
 * analysis pass and the frame reads through the mac helper). The helper is the checkout's build (`TAALCUT_MAC_HELPER`
 * or `native/mac-helper/dist`), as the app's in a checkout; without one, FFmpeg decodes everything, said once.
 */
import { realpath } from 'node:fs/promises';
import {
  createSidecarResolver,
  DECODE_SERVICE_ENV,
  openDecodeService,
  type DecodeService,
  type DecodeServiceTask,
  type SidecarResolver,
} from '@taalcut/media';

/** The helper exits after this long without a request, as the app's. */
const DECODE_IDLE_MS = 120_000;

export interface EvalDecodeOptions {
  /** Where the switch is read. Default: this process's environment. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Tests: finds the helper. Default: the checkout's build. */
  readonly resolver?: Pick<SidecarResolver, 'resolve'>;
  readonly log?: (line: string) => void;
}

/** The decode service over `roots` (the library and the harness's temp folder), or none: FFmpeg decodes. */
export async function evalDecodeService(
  roots: readonly string[],
  options: EvalDecodeOptions = {},
): Promise<DecodeService | undefined> {
  const env = options.env ?? process.env;
  // The helper resolves symlinks (/var → /private/var) before it checks its allowed roots.
  const real = await Promise.all(roots.map((root) => realpath(root).catch(() => root)));
  return openDecodeService({
    setting: env[DECODE_SERVICE_ENV],
    resolver:
      options.resolver ??
      createSidecarResolver({ name: 'taalcut-mac-helper', development: true, pin: '', env: process.env }),
    roots: async () => real,
    idleExitMs: DECODE_IDLE_MS,
    ...(options.log ? { log: options.log } : {}),
  });
}

/** What the decode service took, for the "indexed …" line. */
export function decodeServiceTook(tasks: readonly DecodeServiceTask[]): string {
  return tasks.length > 0 ? tasks.join(' and ') : 'none (FFmpeg)';
}
