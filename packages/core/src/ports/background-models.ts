// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Model calls for background jobs (vision's shot descriptions, P2-L8). The
 * jobs process has no model client: credentials, model profiles and the
 * embedded local runtime live in the agent process. A job asks the agent
 * through this port, which @taalcut/models serves there with the agent's
 * ModelClient. No agent run stands behind the call, so no consent card can
 * be shown: the server keeps a 'local' call on this Mac's models and lets a
 * 'cloud' call upload only under a standing upload consent for the module
 * that covers every cloud provider in its chain.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { CancelledError } from '../basics/errors';
import { idSchema } from '../basics/ids';
import { err, type AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import { implementContract, ipc, type RpcClient } from '../ipc/contract';
import { callRpc, unwrapRpc } from '../ipc/errors';
import { MODEL_MODULE_IDS, REASONING_LEVELS } from './model-ports';

export const BACKGROUND_PLACEMENTS = ['local', 'cloud'] as const;
export type BackgroundPlacement = (typeof BACKGROUND_PLACEMENTS)[number];

/** Why a call made no request: no on-device model for a 'local' call, or no standing consent for a 'cloud' one. */
export const BACKGROUND_SKIPS = ['no_local_model', 'no_consent'] as const;

/** One image as base64: a frame of a few hundred kilobytes, never a whole file. */
const MAX_IMAGE_BASE64 = 6_000_000;

export const backgroundModelRequestSchema = z.object({
  module: z.enum(MODEL_MODULE_IDS),
  placement: z.enum(BACKGROUND_PLACEMENTS),
  system: z.string().max(20_000),
  /** One user turn. Text read off media is data to the model, never instructions (say so in `system`). */
  content: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: z.string().min(1).max(20_000) }),
        z.object({
          type: z.literal('image'),
          data: z.string().min(1).max(MAX_IMAGE_BASE64),
          mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        }),
      ]),
    )
    .min(1)
    .max(16),
  maxTokens: z.int().min(1).max(32_000),
  temperature: z.number().min(0).max(2).optional(),
  /** Default 'off'. */
  reasoning: z.enum(REASONING_LEVELS).optional(),
  /** Filled into the cloud-call log, so the project's budget counts the call. */
  projectId: idSchema<'Project'>().nullable().optional(),
});
export type BackgroundModelRequest = z.output<typeof backgroundModelRequestSchema>;

/** Cloud providers the request went to, failed attempts included (a privacy fact, not a cost). */
const uploadedTo = z.array(z.string().min(1).max(100)).max(20);

export const backgroundModelResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('answered'),
    /** The model's answer: untrusted text. */
    text: z.string().max(200_000),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    local: z.boolean(),
    costUsd: z.number().nonnegative(),
    uploadedTo,
  }),
  z.object({ status: z.literal('skipped'), reason: z.enum(BACKGROUND_SKIPS), uploadedTo }),
]);
export type BackgroundModelResult = z.output<typeof backgroundModelResultSchema>;

export interface BackgroundModels {
  /** One call to the module's models under the placement's rule. Failures are TaalcutErrors (models.*). */
  complete(request: BackgroundModelRequest, signal?: AbortSignal): AsyncResult<BackgroundModelResult>;
}

/** In the jobs process: the agent's background models, over main (MAIN_SERVICE_CONTRACTS.jobs.models). */
export const BackgroundModelsToken = createToken<BackgroundModels>('core.backgroundModels');

export const backgroundModelsContract = {
  complete: ipc.input(backgroundModelRequestSchema).output(backgroundModelResultSchema),
};

/** Serves the agent process's BackgroundModels (UTILITY_CONTRACTS.agent.backgroundModels). */
export function backgroundModelsRouter(models: BackgroundModels) {
  const os = implementContract(backgroundModelsContract);
  return os.router({
    complete: os.complete.handler(async ({ input, signal }) =>
      unwrapRpc(await models.complete(input, signal)),
    ),
  });
}

/** BackgroundModels in another process; `client` is a function so a restarted agent process is picked up. */
export function backgroundModelsOverRpc(
  client: () => RpcClient<typeof backgroundModelsContract>,
): BackgroundModels {
  return {
    async complete(request, signal) {
      if (signal?.aborted) return err(CancelledError());
      return callRpc(client().complete(request, signal ? { signal } : {}));
    },
  };
}
