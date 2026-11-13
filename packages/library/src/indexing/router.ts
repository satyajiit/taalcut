// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** `appContract.indexing` (core's indexingContract), served by the jobs process over the pipeline. */
import { implementContract, indexingContract, ok, unwrapRpc } from '@taalcut/core';
import type { IndexingPipeline } from './indexing-pipeline';

export function indexingRouter(pipeline: IndexingPipeline) {
  const os = implementContract(indexingContract);
  return os.router({
    status: os.status.handler(() => unwrapRpc(ok(pipeline.status()))),
    prioritise: os.prioritise.handler(async ({ input }) =>
      unwrapRpc(await pipeline.prioritise(input.assetIds)),
    ),
    pause: os.pause.handler(async () => unwrapRpc(await pipeline.pause())),
    resume: os.resume.handler(async () => unwrapRpc(await pipeline.resume())),
    retryFailed: os.retryFailed.handler(async ({ input }) =>
      unwrapRpc(await pipeline.retryFailed(input.sourceId)),
    ),
  });
}
