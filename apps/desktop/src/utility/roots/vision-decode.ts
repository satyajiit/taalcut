// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's decode service (IX2-V3, IX2-G3, IX2-F14, IX3-R2), as media's `openDecodeService` gives it from
 * the switch (`TAALCUT_DECODE_SERVICE` in the jobs process's environment: unset is `mac-helper`, the analysis pass and
 * the frame reads through the mac helper; `frames` the frame reads only; `off` neither). Where no helper resolves (not
 * a Mac, or a Mac without it) there is none and FFmpeg decodes everything, said once.
 *
 * The helper may read the library's folders and the media cache (proxies) and write the frame cache (the pass's FIFO
 * and frame files): one process per set of folders, as render's helpers, so a source added later starts another.
 */
import { realpath } from 'node:fs/promises';
import type { Container } from '@taalcut/core';
import {
  DECODE_SERVICE_ENV,
  openDecodeService,
  type DecodeService,
  type SidecarResolver,
} from '@taalcut/media';
import { frameCacheRoot, mediaCacheRoot } from '../../shared/media-cache';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { macHelperResolver } from './mac-helper-resolver';
import { libraryRoots } from './render-phase3';

/** The helper exits after this long without a request. */
const DECODE_IDLE_MS = 120_000;

const realFolder = (path: string) => realpath(path).catch(() => path);

export interface VisionDecodeSeams {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly resolver?: Pick<SidecarResolver, 'resolve'>;
  readonly log?: (line: string) => void;
}

export function visionDecodeService(
  container: Container,
  config: UtilityConfig,
  seams: VisionDecodeSeams = {},
): Promise<DecodeService | undefined> {
  const env = seams.env ?? process.env;
  return openDecodeService({
    setting: env[DECODE_SERVICE_ENV],
    resolver: seams.resolver ?? macHelperResolver(config),
    roots: () =>
      Promise.all(
        [frameCacheRoot(config.userData), mediaCacheRoot(config.userData), ...libraryRoots(container)].map(
          realFolder,
        ),
      ),
    idleExitMs: DECODE_IDLE_MS,
    ...(seams.log ? { log: seams.log } : {}),
  });
}
